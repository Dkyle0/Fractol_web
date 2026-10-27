import { renderSize, type Viewport } from '../domain/camera';
import { copyScene, type SceneState } from '../domain/types';
import { sceneMathKey } from '../domain/sceneIdentity';
import { computeViewingPlan, viewingScene, type ViewingState, type ViewingArithmetic } from '../domain/viewing';
import { advanceQuality, createQualityState, type QualityProfile, type GpuMeasurement } from '../domain/quality';
import { canCoalescePreview, canCoalesceJulia, type ExecutionPolicy } from '../domain/renderPolicy';
import { emptyRenderCounters, type RenderEvent } from '../domain/renderEvents';
import type { PreviewFieldDescriptor } from '../domain/previewCache';
import { RenderCancelledError, type RenderBackend, type RenderStats } from './backend';
import { RenderJobs } from './jobs';
import { ExportService } from './exportService';
import {abortable} from './gpuCompletion';
import {resourcePolicies,nextPresentation,type ResourceMode} from '../domain/resources';
import type {Camera} from '../domain/types';
export interface SessionClock { now(): number; requestFrame(callback: FrameRequestCallback): number; cancelFrame(id: number): void; dpr(): number; wait(ms: number): Promise<void> }
const browserClock: SessionClock = { now: () => performance.now(), requestFrame: cb => requestAnimationFrame(cb), cancelFrame: id => cancelAnimationFrame(id), dpr: () => window.devicePixelRatio || 1, wait: ms => new Promise(resolve => setTimeout(resolve, ms)) };
export interface OperationLease { readonly signal: AbortSignal; setPolicy(policy: ExecutionPolicy): void; release(): void }
export interface SessionStats extends RenderStats { frameMs: number | null; scale: number; interactive: boolean; qualityProfile: QualityProfile; resourceMode: ResourceMode; targetFps:number; renderLimits:import('../domain/renderLimits').RenderLimits; viewing: ViewingState }
export interface RenderFrame { timestamp: number; stats: SessionStats }
interface Callbacks { stats: (value: SessionStats) => void; loading: (value: boolean) => void; error: (value: string) => void; lightGlass: () => void }
/** Owns the source scene. Only derived snapshots reach preview computation. */
export class RenderSession {
  private jobs = new RenderJobs();
  private exporter: ExportService;
  private scene: SceneState;
  private view: Viewport = { width: 1, height: 1 };
  private viewportDpr: number | null = null;
  private frame = 0;
  private dirty = true;
  private presentationDirty = false;
  private presentedInteractive = false;
  private pageHidden = false;
  private operation: { token: symbol; kind: 'export' | 'benchmark'; aborter: AbortController } | null = null;
  private interactingUntil = 0;
  private quality = createQualityState();
  private readyId = '';
  private preparing = false;
  private lastStats = 0;
  private listeners = new Set<(frame: RenderFrame) => void>();
  private failures = new Set<(reason: string) => void>();
  private previewTask: Promise<void> | null = null;
  private previewScene: SceneState | null = null;
  private previewRevisionPending = false;
  private appliedScale = 1;
  private latestPreviewGpu: GpuMeasurement | null = null;
  private unsubscribeMeasurements = () => {};
  private unsubscribeFields = () => {};
  private fieldFramePending = false;
  private emittedDraws = 0;
  private emittedComputations=0;
  private completedKey = '';
  private failedPreviewKey = '';
  private arithmetic: ViewingArithmetic | undefined;
  private resourceMode:ResourceMode='standard';
  private presentationDue=0;
  private juliaSeries=false;
  private juliaIdleCancelled=false;
  private previewKey='';
  private displayedMathKey='';
  private unsubscribeRenderEvents=()=>{};
  private continuousJuliaEnabled=true;
  private previewCacheEnabled=true;
  /** Diagnostic A/B uses identical event instrumentation in both variants. */
  setNavigationFeaturesForDiagnostics(continuousJulia:boolean,cache:boolean) {
    if(this.operation)throw Error('Дождитесь завершения операции.');
    this.cancelPreview();this.continuousJuliaEnabled=continuousJulia;this.previewCacheEnabled=cache;
    this.backend.clearPreviewCache?.();this.backend.configurePreviewCache?.(this.resourceMode,cache);
    this.completedKey='';this.resetCadence();this.invalidate();
  }
  getResourceMode(){return this.resourceMode;}
  getRenderLimits(){const a=this.backend.limits,b=resourcePolicies[this.resourceMode].limits;return {maxDpr:Math.min(a.maxDpr,b.maxDpr),maxPixels:Math.min(a.maxPixels,b.maxPixels)};}
  setResourceMode(mode:ResourceMode,internal=false){
    if(mode===this.resourceMode)return;
    if(!internal)this.operation?.aborter.abort(new Error('Режим ресурсов изменился.'));
    this.cancelPreview();this.resourceMode=mode;this.backend.configurePreviewCache?.(mode,this.previewCacheEnabled&&this.operation?.kind!=='benchmark');this.completedKey='';this.arithmetic=undefined;this.presentationDue=0;
    this.resetCadence();this.invalidate();this.publishStats(undefined,true);
  }
  constrainCamera(camera:Camera){return computeViewingPlan({...this.scene,camera},this.view,this.clock.dpr(),{resourceMode:this.resourceMode,renderLimits:this.getRenderLimits(),unavailable:this.resourceMode==='standard'?this.backend.getPreviewUnavailable?.(this.scene):undefined}).camera;}
  getFinalSize(){return renderSize(this.view,this.clock.dpr(),1,this.getRenderLimits());}
  private get disposed() { return this.jobs.lifecycle === 'disposed'; }
  private get hidden() { return this.pageHidden; }
  private get lost() { return this.jobs.lifecycle === 'context-lost'; }
  private get exporting() { return this.operation?.kind === 'export'; }
  private plan(interactive = this.clock.now() < this.interactingUntil) {
    return computeViewingPlan(this.scene, this.view, this.clock.dpr(), { interactive, previousArithmetic: this.arithmetic,
      unavailable: this.resourceMode==='standard'?this.backend.getPreviewUnavailable?.(this.scene):undefined, renderLimits: this.getRenderLimits(), resourceMode:this.resourceMode });
  }
  private requestKey(plan: ViewingState, interactive: boolean) {
    const size = renderSize(this.view, this.clock.dpr(), interactive ? this.quality.scale : 1, this.getRenderLimits());
    return JSON.stringify([sceneMathKey(viewingScene(this.scene, plan)), plan.arithmetic, size]);
  }
  getViewState(): ViewingState {
    const interactive = this.clock.now() < this.interactingUntil, plan = this.plan(interactive);
    plan.ready = !this.previewTask && this.completedKey === this.requestKey(plan, interactive) && (this.backend.isPreviewFieldReady?.(this.descriptor(plan,interactive))??true);
    plan.updatingJulia=this.juliaSeries&&this.displayedMathKey!==sceneMathKey(viewingScene(this.scene,plan));
    return plan;
  }
  private cancelPreview(keepJulia=false) { if(!keepJulia){this.juliaSeries=false;this.juliaIdleCancelled=false;}this.jobs.invalidate(); this.failedPreviewKey = ''; this.previewScene = null; this.previewRevisionPending = false; this.fieldFramePending = false; this.backend.cancelRefinement(); }
  private descriptor(plan:ViewingState,interactive:boolean):PreviewFieldDescriptor {
    const size=renderSize(this.view,this.clock.dpr(),interactive?this.quality.scale:1,this.getRenderLimits());
    return {scene:viewingScene(this.scene,plan),arithmetic:plan.arithmetic,arithmeticVersion:this.backend.previewArithmeticVersion?.(plan.arithmetic)??plan.arithmetic,...size};
  }
  private retainSettledField() {
    if(this.hidden||this.lost||this.disposed||this.operation||this.clock.now()<this.interactingUntil||this.previewTask)return;
    const plan=this.getViewState();if(plan.ready)this.backend.retainPreviewField?.(this.descriptor(plan,false));
  }
  subscribeRenderEvents(listener:(event:RenderEvent)=>void){return this.backend.subscribeRenderEvents?.(listener)??(()=>{});}
  getRenderCounters(){return this.backend.getRenderCounters?.()??emptyRenderCounters();}
  drainGpuMeasurements(maxMs:number,signal?:AbortSignal){return this.backend.drainGpuMeasurements?.(maxMs,signal)??Promise.resolve();}
  async waitForViewingField(signal:AbortSignal) {
    while(!this.getViewState().ready) {
      signal.throwIfAborted();
      if(this.disposed||this.hidden||this.lost)throw new RenderCancelledError();
      if(this.failedPreviewKey===this.requestKey(this.plan(),this.clock.now()<this.interactingUntil))throw Error('Итоговое поле не рассчитано.');
      await this.clock.wait(8);
    }
    signal.throwIfAborted();
  }
  private publishStats(now = this.clock.now(), force = false) {
    if (force || now - this.lastStats >= 250) { this.callbacks.stats(this.getStats()); this.lastStats = now; }
  }
  private publishFrame(timestamp: number) {
    if(this.resourceMode==='economy'&&this.previewTask)return;
    const stats = this.getStats(); if (stats.draws <= this.emittedDraws && stats.computations<=this.emittedComputations) return;
    this.emittedDraws = stats.draws;this.emittedComputations=stats.computations; for (const listener of this.listeners) listener({ timestamp, stats });
  }
  constructor(private backend: RenderBackend, scene: SceneState, private callbacks: Callbacks, private clock: SessionClock = browserClock) {
    this.scene = copyScene(scene); this.exporter = new ExportService(backend);
    this.backend.configurePreviewCache?.(this.resourceMode,true);
    this.unsubscribeRenderEvents=this.subscribeRenderEvents(event=>{if(event.type==='field-ready'){
      this.retainSettledField();this.publishStats(undefined,!this.previewTask&&this.clock.now()>=this.interactingUntil);
    }});
    this.unsubscribeMeasurements = backend.subscribeMeasurements?.(sample => { if (sample.kind === 'preview') this.latestPreviewGpu = sample; }) ?? (() => {});
    this.unsubscribeFields = backend.subscribeFields?.(update => {
      if (!this.jobs.current(update.job) || this.hidden || this.lost || this.exporting || update.arithmetic === 'binary64') return;
      // Once a partial field replaces the front buffer, the previous complete
      // field key can no longer be reused after cancellation.
      if (!update.complete) this.completedKey = '';
      if(update.tile&&this.previewScene)this.displayedMathKey=sceneMathKey(this.previewScene);
      this.publishStats(); this.fieldFramePending = true; this.scheduleFrame();
    }) ?? (() => {});
  }
  subscribe(listener: (frame: RenderFrame) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onFailure(listener: (reason: string) => void) { this.failures.add(listener); return () => { this.failures.delete(listener); }; }
  private fail(reason: string) { this.callbacks.error(reason); for (const listener of this.failures) listener(reason); }
  resetMeasurement() { this.latestPreviewGpu = null; this.quality = createQualityState(this.quality.profile, this.backend.getSnapshot().gpuSampleId); this.backend.resetMeasurement(); }
  setQualityProfile(profile: QualityProfile) {
    if (profile === this.quality.profile) return;
    if (this.previewTask) this.cancelPreview();
    this.latestPreviewGpu = null; this.quality = createQualityState(profile, this.backend.getSnapshot().gpuSampleId);
    this.backend.resetMeasurement(); this.invalidate();
  }
  getQualityProfile() { return this.quality.profile; }
  private resetCadence() { this.quality = createQualityState(this.quality.profile, this.backend.getSnapshot().gpuSampleId, this.quality.glassReduced); }
  update(scene: SceneState, interactive = false, source:'default'|'julia-pointer'='default') {
    const mathChanged = sceneMathKey(scene) !== sceneMathKey(this.scene);
    const colorChanged = JSON.stringify(scene.coloring) !== JSON.stringify(this.scene.coloring);
    if (!mathChanged && !colorChanged) {
      if (interactive) this.interact();
      return;
    }
    this.presentationDirty ||= colorChanged;
    if (mathChanged) {
      if(this.exporting)this.operation?.aborter.abort(new Error('Исходная сцена изменилась. Экспорт прерван.'));
      this.backend.invalidateExportCache?.();
      const candidate = viewingScene(scene, computeViewingPlan(scene, this.view, this.clock.dpr(), { interactive: interactive || this.clock.now() < this.interactingUntil,resourceMode:this.resourceMode,renderLimits:this.getRenderLimits() }));
      const sameStructure=scene.iterations===this.scene.iterations&&JSON.stringify(scene.parameters)===JSON.stringify(this.scene.parameters);
      const julia=this.continuousJuliaEnabled&&source==='julia-pointer'&&canCoalesceJulia(this.scene,scene)&&(!this.previewScene||canCoalesceJulia(this.previewScene,candidate));
      if(julia){
        // A job started before the pointer series may still publish tiles.
        // Retire it once so every subsequent publication is atomic.
        if(!this.juliaSeries&&this.previewTask&&this.previewScene)this.cancelPreview();
        this.juliaSeries=true;this.juliaIdleCancelled=false;
        if(this.previewTask)this.previewRevisionPending=true;else this.jobs.invalidate();
      }
      else {
        this.presentationDirty=true;
        if (sameStructure && !this.juliaSeries && this.previewTask && this.previewScene && (interactive || this.clock.now() < this.interactingUntil) && canCoalescePreview(this.previewScene, candidate)) this.previewRevisionPending = true;
        else this.cancelPreview();
      }
    }
    this.scene = copyScene(scene); if (interactive) this.interact(); this.invalidate();
  }
  resize(view: Viewport) {
    const dpr = this.clock.dpr();
    if (view.width === this.view.width && view.height === this.view.height && dpr === this.viewportDpr) return;
    this.cancelPreview(); this.view = { ...view }; this.viewportDpr = dpr; this.resetCadence(); this.invalidate();
  }
  interact() {
    const now = this.clock.now(); if (now >= this.interactingUntil) {
      this.resetCadence();
    }
    this.interactingUntil = now + 150; this.dirty = true; this.scheduleFrame();
  }
  private invalidate() { this.dirty = true; this.scheduleFrame(); }
  private scheduleFrame() { if (!this.frame && !this.disposed && !this.hidden && !this.lost && !this.exporting) this.frame = this.clock.requestFrame(this.draw); }
  private draw = async (now: number) => {
    this.frame = 0; if (this.disposed || this.hidden || this.lost || this.exporting) return;
    if(this.resourceMode==='economy' && now+0.05<this.presentationDue){this.scheduleFrame();return;}
    const drawsBefore=this.backend.getSnapshot().draws;
    if (this.readyId !== this.scene.fractalId) {
      if (this.preparing) return;
      this.preparing = true; this.callbacks.loading(true); this.resetCadence();
      const id = this.scene.fractalId, job = this.jobs.begin('prepare'); let succeeded = false;
      try { await this.backend.prepare(id, 'float32'); succeeded = true; if (this.jobs.current(job)) this.readyId = id; }
      catch (error) { if (!this.lost && !this.disposed && this.jobs.current(job) && !(error instanceof RenderCancelledError)) this.fail(message(error)); }
      finally { this.preparing = false; if (!this.disposed) this.callbacks.loading(false); }
      if (!this.disposed && !this.lost && (succeeded || !this.jobs.current(job))) this.invalidate();
      this.jobs.finish(job); return;
    }
    const interactive = now < this.interactingUntil;
    if (interactive) {
      const previous = this.quality, snapshot = this.backend.getSnapshot();
      const latency = snapshot.previewStartedAt != null ? now - snapshot.previewStartedAt : snapshot.previewCompletedAt != null && now - snapshot.previewCompletedAt <= 250 ? snapshot.previewLatencyMs ?? null : null;
      this.quality = advanceQuality(previous, now, snapshot.width, snapshot.height, this.latestPreviewGpu ?? snapshot.gpuSample, latency,this.resourceMode==='economy');
      if (this.quality.scale !== previous.scale) this.dirty = true;
      if (this.quality.glassReduced && !previous.glassReduced) this.callbacks.lightGlass();
    }
    const plan = this.plan(interactive), scene = viewingScene(this.scene, plan);
    if(this.juliaSeries&&!interactive&&this.previewTask&&!this.juliaIdleCancelled&&this.previewKey!==this.requestKey(plan,false)){
      this.cancelPreview(true);this.juliaIdleCancelled=true;this.dirty=true;
    }
    if (this.previewTask) {
      if(this.resourceMode==='economy'){if(interactive)this.scheduleFrame();return;}
      if (this.dirty || this.fieldFramePending) {
        // A published WebGL tile has already been presented. Only redraw it
        // for newer input, or when a backend notified without presenting.
        if (this.presentationDirty || (!this.juliaSeries && this.dirty) || (this.fieldFramePending && this.backend.getSnapshot().draws <= this.emittedDraws)) {
          this.backend.recolor(scene);this.presentationDirty=false;
        }
        this.dirty = false; this.fieldFramePending = false; this.publishStats(now); this.publishFrame(now);
      }
      if (interactive) this.scheduleFrame(); return;
    }
    if (this.dirty || (!interactive && this.presentedInteractive)) {
      this.dirty = false;
      try {
        const size = renderSize(this.view, this.clock.dpr(), interactive ? this.quality.scale : 1, this.getRenderLimits());
        const key = this.requestKey(plan, interactive);
        if (this.failedPreviewKey === key) return;
        this.backend.resize(size.width, size.height, renderSize(this.view, this.clock.dpr(), 1, this.getRenderLimits()));
        this.appliedScale = interactive ? this.quality.scale : 1; this.arithmetic = plan.arithmetic; this.presentedInteractive = interactive;
        if (this.completedKey === key && this.backend.hasField()) {
          if (this.presentationDirty) this.backend.recolor(scene);
          this.presentationDirty = false;
        }
        else {
          if (this.previewRevisionPending) { this.jobs.invalidate(); this.previewRevisionPending = false; }
          const job = this.jobs.begin('preview');
          if(this.backend.restorePreviewField?.(this.descriptor(plan,interactive),job)){
            this.completedKey=key;this.displayedMathKey=sceneMathKey(scene);this.presentationDirty=false;this.jobs.finish(job);
            if(!interactive)this.juliaSeries=false;
            if(this.resourceMode==='economy')this.presentationDue=nextPresentation(now,this.presentationDue,resourcePolicies[this.resourceMode].targetFps);
            this.publishFrame(now);this.publishStats(now,!interactive);if(interactive)this.scheduleFrame();return;
          }
          // Even a pending float32 submission can already replace the front
          // field. A cancelled replacement cannot resurrect the old cache key.
          this.completedKey = '';
          const atomic=this.juliaSeries;
          const preview = this.backend.preview({ scene, job, arithmetic: plan.arithmetic, interactive,publication:atomic?'atomic':'progressive',waitForCompletion:this.resourceMode==='economy' });
          this.presentationDirty = false;
          if (preview) {
            const pending = Promise.resolve(preview).then(() => { if (this.jobs.current(job) && (this.resourceMode==='economy'||!this.backend.getPreviewUnavailable?.(this.scene))) {
              this.completedKey = key;this.displayedMathKey=sceneMathKey(scene);
              // Atomic fields are presented at completion, rather than submission.
              if(atomic&&this.resourceMode==='economy')this.presentationDue=nextPresentation(this.clock.now(),this.presentationDue,resourcePolicies[this.resourceMode].targetFps);
            } })
              .catch(error => {
                if (this.jobs.current(job) && !(error instanceof RenderCancelledError)) {
                  this.failedPreviewKey = key;
                  this.fail(message(error));
                }
              })
              .finally(() => {
                this.jobs.finish(job);
                if (this.previewTask === pending) {
                  this.previewTask = null; this.previewScene = null;
                  const nextKey = this.requestKey(this.plan(), this.clock.now() < this.interactingUntil);
                  if (this.completedKey !== nextKey && this.failedPreviewKey !== nextKey) this.dirty = true;
                  if(this.completedKey===nextKey&&this.clock.now()>=this.interactingUntil)this.juliaSeries=false;
                  this.retainSettledField();
                  this.publishFrame(this.clock.now());this.publishStats(undefined, this.clock.now()>=this.interactingUntil); this.scheduleFrame();
                }
              });
            this.previewTask = pending; this.previewScene = scene;this.previewKey=key;
          } else { this.completedKey = key;this.displayedMathKey=sceneMathKey(scene); this.jobs.finish(job); }
        }
        this.fieldFramePending = false; this.publishFrame(now); this.publishStats(now, !interactive);
      } catch (error) { this.fail(message(error)); }
    }
    if (this.fieldFramePending) { this.fieldFramePending = false; this.publishFrame(now); }
    if(this.resourceMode==='economy'&&this.backend.getSnapshot().draws>drawsBefore)this.presentationDue=nextPresentation(now,this.presentationDue,resourcePolicies[this.resourceMode].targetFps);
    if(!interactive){this.retainSettledField();if(this.getViewState().ready)this.juliaSeries=false;}
    if (interactive) this.scheduleFrame();
  };
  visibility(hidden: boolean) {
    // Shared shader preparation can outlive its cancelled caller. Gate its
    // onYield presentations before cancellation, not only this session's rAF.
    this.backend.setVisible(!hidden);
    if (hidden) {this.cancelPreview();this.backend.clearPreviewCache?.();this.backend.invalidateExportCache?.();} this.pageHidden = hidden; if (!this.lost) this.jobs.transition(hidden ? 'hidden' : 'active');
    if (hidden) this.operation?.aborter.abort(new Error('Вкладка скрыта.')); this.resetCadence();
    if (hidden) { this.clock.cancelFrame(this.frame); this.frame = 0; } else { this.presentationDirty = true; this.invalidate(); }
  }
  contextLost() { this.cancelPreview();this.backend.clearPreviewCache?.();this.displayedMathKey=''; this.completedKey = ''; for (const listener of this.failures) listener('Потерян контекст WebGL.'); this.jobs.transition('context-lost'); this.operation?.aborter.abort(new Error('Потерян контекст WebGL.')); this.readyId = ''; this.resetCadence(); this.clock.cancelFrame(this.frame); this.frame = 0; this.callbacks.loading(false); }
  contextRestored() { this.latestPreviewGpu = null; this.arithmetic = undefined; this.backend.restore(); this.jobs.transition(this.pageHidden ? 'hidden' : 'active'); this.readyId = ''; this.completedKey = ''; this.invalidate(); }
  resetGlassAdaptation() { this.quality = { ...this.quality, glassReduced: false, overloadedSince: null }; }
  getCapabilities() { return this.backend.getCapabilities(); }
  getMemoryEstimate() { return { ...this.backend.getMemoryEstimate(), ...this.exporter.getMemoryEstimate() }; }
  subscribeGpuMeasurements(listener: (sample: GpuMeasurement) => void) { return this.backend.subscribeMeasurements?.(listener) ?? (() => {}); }
  prepare(id: SceneState['fractalId']) {
    if (id === this.scene.fractalId && this.backend.preparePreview) {
      const plan = this.plan(true), size = renderSize(this.view, this.clock.dpr(), 1, this.getRenderLimits());
      return this.backend.preparePreview({ scene: viewingScene(this.scene, plan), arithmetic: plan.arithmetic, ...size });
    }
    return this.backend.prepare(id, 'float32');
  }
  resetGpuMeasurement() { this.latestPreviewGpu = null; this.backend.resetMeasurement(); }
  acquireOperation(kind: 'export' | 'benchmark'): OperationLease {
    if (this.disposed || this.hidden || this.lost || this.backend.isContextLost() || this.operation) throw new Error('Дождитесь готовности изображения.');
    const originalMode=this.resourceMode;
    const token = Symbol(kind), aborter = new AbortController(), profile = this.quality.profile, glassReduced = this.quality.glassReduced;
    this.operation = { token, kind, aborter }; this.cancelPreview();this.backend.configurePreviewCache?.(this.resourceMode,this.previewCacheEnabled&&kind!=='benchmark');
    if (kind === 'export') { this.clock.cancelFrame(this.frame); this.frame = 0; }
    return { signal: aborter.signal,
      setPolicy: next => { if (this.operation?.token !== token) throw new Error('Операция уже завершена.'); if (next.automaticRefinement) throw new Error('Точный расчёт доступен только при экспорте PNG.'); },
      release: () => {
        if (this.operation?.token !== token) return;
        this.operation = null; this.resourceMode=originalMode;this.presentationDue=0; aborter.abort(new RenderCancelledError()); this.quality = createQualityState(profile, this.backend.getSnapshot().gpuSampleId, glassReduced);
        if (this.disposed) return;this.backend.configurePreviewCache?.(this.resourceMode,this.previewCacheEnabled); this.cancelPreview(); if (!this.lost) this.backend.resetMeasurement();if(this.hidden)this.backend.invalidateExportCache?.(); this.invalidate();
      } };
  }
  async export(width: number, height: number, signal?: AbortSignal, progress?: (fraction: number) => void, options: { iterations?: number } = {}) {
    const lease = this.acquireOperation('export'), snapshot = copyScene(this.scene), abort = () => this.operation?.aborter.abort(signal?.reason);
    if (options.iterations !== undefined) snapshot.iterations = options.iterations;
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    try {
      if(this.previewTask)await abortable(this.previewTask,lease.signal);
      lease.signal.throwIfAborted(); const job = this.jobs.begin('export');
      try { return await this.exporter.run({ scene: snapshot, width, height, arithmetic: 'binary64', job }, lease.signal, progress); }
      finally { this.jobs.finish(job); }
    } finally { signal?.removeEventListener('abort', abort); lease.release(); }
  }
  async exportViewing(signal?:AbortSignal){
    const state=this.getViewState();
    if(!state.ready||!this.backend.captureViewingField)throw Error('Дождитесь готовности изображения.');
    const snapshot=viewingScene(this.scene,state),stats=this.backend.getSnapshot();
    const width=stats.computeWidth||stats.width,height=stats.computeHeight||stats.height;
    const lease=this.acquireOperation('export'),abort=()=>this.operation?.aborter.abort(signal?.reason);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try{return await this.backend.captureViewingField(snapshot,width,height,lease.signal);}
    finally{signal?.removeEventListener('abort',abort);lease.release();}
  }
  getStats(): SessionStats {
    const snapshot = this.backend.getSnapshot(), viewing = this.getViewState();
    return { ...snapshot, phase: 'preview', progress: viewing.ready ? 1 : snapshot.progress, timeUntilPreciseMs: null,
      resourceMode:this.resourceMode,targetFps:resourcePolicies[this.resourceMode].targetFps,renderLimits:this.getRenderLimits(),scale: this.appliedScale, interactive: this.presentedInteractive, frameMs: this.quality.frameMs, qualityProfile: this.quality.profile, viewing };
  }
  dispose() { if (this.disposed) return; this.cancelPreview();this.unsubscribeRenderEvents(); this.unsubscribeFields(); this.unsubscribeMeasurements(); for (const listener of this.failures) listener('Рендерер остановлен.'); this.listeners.clear(); this.failures.clear(); this.jobs.transition('disposed'); this.operation?.aborter.abort(new Error('Рендерер остановлен.')); this.clock.cancelFrame(this.frame); this.backend.dispose(); }
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось построить изображение.';
