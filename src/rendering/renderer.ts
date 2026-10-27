import { orbitSlicedField as binary64Field,type PrecisionExecutor,type OrbitContext } from './webgl/orbitSlicedField';
import {flatPreview} from './webgl/flatPreview';
import { copyScene, type FractalId, type SceneState } from '../domain/types';
import { sceneMathKey, sameSceneMath } from '../domain/sceneIdentity';
import { ARITHMETIC_VERSION } from './binary64';
import {kernelVariants,kernelId,type KernelVariant} from './kernel';
import { abortable } from './gpuCompletion';
import { defaultRenderLimits } from '../domain/renderLimits';
import { RenderCancelledError, type RenderBackend, type RenderStats, type FieldRequest, type ExportRequest,type FieldUpdate,type PreviewPreparation } from './backend';
import type {FieldTile} from '../domain/fieldTiles';
import {DOUBLE_SINGLE_VERSION} from './doubleSingle';
import { WebGLResources } from './webgl/resources';
import { WebGLPrograms, type Program } from './webgl/programs';
import { WebGLMeasurements } from './webgl/measurements';
import { floatField, colorField,fieldProjection } from './webgl/passes';
import { encodePng } from './png';
import { decodeOutcome } from './outcomes';
import type { RenderJob } from './jobs';
import type {OrbitActivitySample} from '../domain/activeOrbits';
import type {PreviewGenerator} from './previewKernel';
import {submitFence,settleFence} from './gpuQueue';
import { RenderEvents } from './renderEvents';
import { GpuReadiness } from './webgl/readiness';
import { createFieldSurface, disposeFieldSurface, type FieldSurface } from './webgl/fieldSurface';
import { PreviewFieldCache, previewFieldKey, type PreviewFieldDescriptor } from '../domain/previewCache';
import type { FieldEventSource, PresentationKind } from '../domain/renderEvents';
import type { ResourceMode } from '../domain/resources';
export { RenderCancelledError } from './backend';
export type { RenderStats } from './backend';
export class WebGLBackend implements RenderBackend {
  readonly limits = defaultRenderLimits;
  private gl: WebGL2RenderingContext;
  private resources: WebGLResources;
  private exportScreenResources:WebGLResources|null=null;
  private exportPresentation:{resources:WebGLResources;fieldScene:SceneState|null;scene:SceneState|null;surface:{width:number;height:number};source:FieldEventSource|null}|null=null;
  private cachedExport: {resources:WebGLResources;scene:SceneState;key:string;width:number;height:number}|null=null;
  private previewFailures=new Map<string,string>();
  private library: WebGLPrograms;
  private measurements: WebGLMeasurements;
  private capabilities!: ReturnType<WebGLBackend['readCapabilities']>;
  private fieldScene: SceneState | null = null;
  private calculationKey = '';
  private disposed = false;
  private visible = true;
  private generation = 0;
  private task = new AbortController();
  private refinement: Promise<void> = Promise.resolve();
  private presentationScene:SceneState|null=null;
  private precisionExecutor:PrecisionExecutor='queue';
  private precisionBudget:3|6=6;
  private activityListeners=new Set<(sample:OrbitActivitySample)=>void>();
  subscribeOrbitActivity(listener:(sample:OrbitActivitySample)=>void){this.activityListeners.add(listener);return()=>{this.activityListeners.delete(listener);};}
  private fieldListeners=new Set<(event:FieldUpdate)=>void>();
  private computing=false;
  private captureBytes=0;
  private activeField:SceneState|null=null;
  private surface={width:0,height:0};
  private events = new RenderEvents();
  private readiness: GpuReadiness;
  private previewCache: PreviewFieldCache<FieldSurface>;
  private cacheEnabled = true;
  private visibleSource: FieldEventSource | null = null;
  private readyFieldId = 0;
  private previewVariantRevision = 0;
  subscribeRenderEvents(...args: Parameters<RenderEvents['subscribe']>) { return this.events.subscribe(...args); }
  getRenderCounters() { return this.events.snapshot(); }
  previewArithmeticVersion(arithmetic:'float32'|'double-single') { return arithmetic === 'float32' ? 'float32-v1' : `${DOUBLE_SINGLE_VERSION}:implementation-${this.previewVariantRevision}`; }
  private describe(scene:SceneState, arithmetic:'float32'|'double-single', width:number, height:number):PreviewFieldDescriptor {
    return { scene, arithmetic, arithmeticVersion:this.previewArithmeticVersion(arithmetic), width, height };
  }
  private fieldSource(scene:SceneState, arithmetic:'float32'|'double-single'|'binary64',width:number,height:number,job?:RenderJob):FieldEventSource {
    return {fieldId:this.events.nextFieldId(),fieldKey:arithmetic==='binary64'?this.preciseKey(scene,width,height):previewFieldKey(this.describe(scene,arithmetic,width,height)),
      jobId:job?.id??0,sceneRevision:job?.sceneRevision??0,contextGeneration:this.generation,
      arithmetic:arithmetic==='binary64'?ARITHMETIC_VERSION:arithmetic==='double-single'?DOUBLE_SINGLE_VERSION:'float32',
      iterations:scene.iterations,width,height,submittedAt:performance.now()};
  }
  configurePreviewCache(mode:ResourceMode,enabled:boolean) { this.previewCache.setMode(mode); this.cacheEnabled=enabled; }
  clearPreviewCache() { if(this.gl.isContextLost())this.previewCache.abandon();else this.previewCache.clear(); }
  isPreviewFieldReady(field:PreviewFieldDescriptor) {
    return !this.computing&&!!this.visibleSource&&this.readyFieldId===this.visibleSource.fieldId&&this.visibleSource.fieldKey===previewFieldKey(field);
  }
  retainPreviewField(field:PreviewFieldDescriptor) {
    const source=this.visibleSource,key=previewFieldKey(field),gl=this.gl,generation=this.generation;
    if(!this.cacheEnabled||!this.visible||this.disposed||gl.isContextLost()||this.computing||!source||
      source.fieldId!==this.readyFieldId||source.fieldKey!==key||this.previewCache.has(key)||!sameSceneMath(this.fieldScene,field.scene))return;
    const surface=this.previewCache.allocate(field,()=>createFieldSurface(gl,field.width,field.height));
    if(!surface)return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.resources.framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,surface.framebuffer);
    gl.blitFramebuffer(0,0,field.width,field.height,0,0,field.width,field.height,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    this.readiness.watch(()=>{if(generation===this.generation)this.previewCache.markReady(key,surface);},()=>this.previewCache.remove(key,surface));
  }
  restorePreviewField(field:PreviewFieldDescriptor,job:RenderJob) {
    if(!this.cacheEnabled||this.computing||this.disposed||!this.visible||this.gl.isContextLost())return false;
    const surface=this.previewCache.get(previewFieldKey(field));if(!surface)return false;
    const gl=this.gl;this.resources.allocate(false,field.width,field.height);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,surface.framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.resources.framebuffer);
    gl.blitFramebuffer(0,0,field.width,field.height,0,0,field.width,field.height,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    this.fieldScene=copyScene(field.scene);this.presentationScene=copyScene(field.scene);
    this.calculationKey=field.arithmetic==='float32'?JSON.stringify([sceneMathKey(field.scene),field.width,field.height]):this.preciseKey(field.scene,field.width,field.height).replace('binary64:','double-single:');
    this.stats.arithmetic=field.arithmetic==='float32'?'float32':DOUBLE_SINGLE_VERSION;this.stats.phase='preview';this.stats.progress=1;
    this.visibleSource=this.fieldSource(field.scene,field.arithmetic,field.width,field.height,job);this.readyFieldId=this.visibleSource.fieldId;
    this.events.emit('field-restored',this.visibleSource);this.present(field.scene,'cache');return true;
  }
  async drainGpuMeasurements(maxMs:number,signal?:AbortSignal) {
    const generation=this.generation,end=performance.now()+Math.max(0,Math.min(500,maxMs));
    while(!signal?.aborted&&!this.disposed&&generation===this.generation&&!this.gl.isContextLost()) {
      this.measurements.poll();if(!this.measurements.hasPending||performance.now()>=end)return;
      await new Promise<void>(resolve=>setTimeout(resolve,8));
    }
  }
  stats: RenderStats = { draws: 0, computations: 0, width: 0, height: 0, gpuMs: null, renderer: 'WebGL2', fractalId: null, gpuSampleId: 0, gpuSample: null, arithmetic: 'float32', phase: 'preview', progress: 0, computeWidth: 0, computeHeight: 0, timeUntilPreciseMs: null };
  getSnapshot(): Readonly<RenderStats> { return { ...this.stats, gpuSample: this.stats.gpuSample ? { ...this.stats.gpuSample } : null }; }
  private previewSignature(scene:SceneState){return JSON.stringify([scene.fractalId,scene.parameters.power]);}
  getPreviewUnavailable(scene:SceneState){return this.library.doubleSingleFailure??this.previewFailures.get(this.previewSignature(scene));}
  invalidateExportCache(){this.cachedExport?.resources.dispose();this.cachedExport=null;}
  subscribeMeasurements(...args:Parameters<WebGLMeasurements['subscribe']>){return this.measurements.subscribe(...args);}
  getMemoryEstimate() {
    const current=this.resources.estimate(),saved=this.exportScreenResources?.estimate(),cached=this.cachedExport?.resources.estimate();
    return {...current,fieldBytes:current.fieldBytes+(saved?.fieldBytes??0)+(cached?.fieldBytes??0)+this.captureBytes/3+this.previewCache.bytes,previewCacheBytes:this.previewCache.bytes,previewCacheEntries:this.previewCache.size,previewCacheUnavailable:this.previewCache.unavailable,captureCpuBufferBytes:this.captureBytes*2/3,instructionBytes:current.instructionBytes+(saved?.instructionBytes??0)+(cached?.instructionBytes??0)};
  }
  isContextLost() { return this.gl.isContextLost(); }
  setVisible(visible: boolean) { this.visible = visible; }
  get compilationDelay() { return this.library.delay.bind(this.library); }
  set compilationDelay(delay: () => Promise<void>) { this.library.delay = delay; }
  subscribeFields(listener:(event:FieldUpdate)=>void){this.fieldListeners.add(listener);return()=>{this.fieldListeners.delete(listener);};}
  setPrecisionExecutor(executor:PrecisionExecutor){this.precisionExecutor=executor;}
  setPreviewGenerator(generator:PreviewGenerator){
    if(this.computing)throw Error('Дождитесь завершения GPU-операции.');
    if(generator!=='switch'&&generator!=='structured')throw Error('Неизвестный генератор предпросмотра.');
    this.cancelRefinement();this.clearPreviewCache();this.previewVariantRevision++;this.readyFieldId=0;this.library.setPreviewGenerator(generator);this.calculationKey='';
  }
  /** Diagnostic override; exact fields default to 6 ms, previews keep their own budget. */
  setPrecisionBudget(target:3|6){this.precisionBudget=target;}
  /** Diagnostic selection, configured before starting a GPU operation. */
  setKernelVariant(variant:KernelVariant){
    if(!kernelVariants.includes(variant))throw Error('Неизвестный вариант binary64.');
    if(this.computing)throw Error('Дождитесь завершения GPU-операции.');
    this.cancelRefinement();this.library.setKernelVariant(variant);this.calculationKey='';
  }
  preview(request: FieldRequest):void|Promise<void> {
    this.presentationScene=copyScene(request.scene);
    if(request.arithmetic!=='double-single'&&request.publication==='atomic')return this.atomicFloatPreview(request);
    if(request.waitForCompletion){
      if(request.arithmetic==='double-single')throw Error('Этот исполнитель ожидает только поле float32.');
      const generation=this.generation;
      this.cancelRefinement();this.task=new AbortController();const task=this.task;
      const before=this.stats.computations,started=performance.now();
      this.draw(request.scene,request.reproject,request.job);
      const computed=this.stats.computations>before;
      if(!computed)return;
      this.stats.computations=before;this.stats.previewStartedAt=started;
      const fence=submitFence(this.gl);
      return settleFence(this.gl,fence,()=>new Promise<void>(resolve=>setTimeout(resolve,8)),()=>this.ensureActive(generation),()=>generation===this.generation&&!this.gl.isContextLost()).then(()=>{
        task.signal.throwIfAborted();this.ensureActive(generation);this.measurements.poll();
        this.stats.computations++;this.stats.previewCompletedAt=performance.now();this.stats.previewLatencyMs=this.stats.previewCompletedAt-started;
      }).finally(()=>{if(this.task===task)this.stats.previewStartedAt=undefined;});
    }
    this.stats.previewUnavailable=this.getPreviewUnavailable(request.scene);
    if(request.arithmetic==='double-single'&&!request.reproject&&!this.stats.previewUnavailable){
      if(!this.task.signal.aborted&&sameSceneMath(this.activeField,request.scene)){this.draw(request.scene,true,request.job);return;}
      if(this.calculationKey===this.preciseKey(request.scene).replace('binary64:','double-single:')){this.draw(request.scene,true,request.job);return;}
      this.draw(request.scene,true,request.job);
      const generation=this.generation,result=this.refine(request.scene,request.progress,undefined,request.job,request.width,request.height,'double-single',request.publication),task=this.task;
      return result.catch(error=>{
        if(error instanceof RenderCancelledError||task.signal.aborted||generation!==this.generation||this.disposed)throw new RenderCancelledError();
        this.stats.previewUnavailable=error instanceof Error?error.message:String(error);
        this.previewFailures.set(this.previewSignature(request.scene),this.stats.previewUnavailable);
      });
    }
    this.draw(request.scene, request.reproject, request.job);
  }
  private async atomicFloatPreview(request:FieldRequest) {
    const gl=this.gl,generation=this.generation,scene=copyScene(request.scene),width=this.stats.width,height=this.stats.height;
    this.cancelRefinement();this.task=new AbortController();const task=this.task;
    const program=this.library.programs.get(scene.fractalId);if(!program)throw Error('Программа Julia не готова.');
    const source=this.fieldSource(scene,'float32',width,height,request.job);this.events.emit('field-submitted',source);
    this.computing=true;this.stats.previewStartedAt=performance.now();
    try {
      this.measurements.poll();
      this.resources.allocate(true,width,height);
      gl.bindVertexArray(this.resources.vao);gl.viewport(0,0,width,height);
      const timed=this.measurements.begin({...jobMetadata(request.job),submittedAt:source.submittedAt,width,height,kind:'preview'});
      try{floatField(gl,program,(p,n)=>this.uniform(p,n),this.resources.backFramebuffer,width,height,scene);}finally{this.measurements.end(timed);}
      // This pass only writes the back field; the visible surface remains untouched.
      const fence=submitFence(gl);
      await settleFence(gl,fence,()=>new Promise<void>(resolve=>setTimeout(resolve,8)),()=>this.ensureActive(generation),()=>generation===this.generation&&!gl.isContextLost());
      task.signal.throwIfAborted();this.ensureActive(generation);
      this.measurements.poll();
      this.resources.swap();this.fieldScene=scene;this.visibleSource=source;this.readyFieldId=source.fieldId;
      this.calculationKey=JSON.stringify([sceneMathKey(scene),width,height]);this.stats.arithmetic='float32';this.stats.computations++;this.stats.progress=1;
      this.stats.previewCompletedAt=performance.now();this.stats.previewLatencyMs=this.stats.previewCompletedAt-this.stats.previewStartedAt!;
      this.events.emit('field-ready',source);this.present(this.presentationScene??scene,'computed');
    }catch(error){this.events.emit('field-cancelled',source,{reason:String(error)});throw error;}
    finally{if(this.task===task){this.computing=false;this.stats.previewStartedAt=undefined;}}
  }
  recolor(scene: SceneState, job?: RenderJob) { this.draw(scene, true, job); }
  refineField(request: FieldRequest, signal?: AbortSignal) { return this.refine(request.scene, request.progress, signal, request.job,request.width,request.height); }
  exportFrame(request: ExportRequest, signal?: AbortSignal, progress?: (fraction: number) => void) {
    if (request.arithmetic !== 'binary64') return Promise.reject(new Error('Запрошенная точность экспорта пока не поддерживается.'));
    return this.export(request.scene, request.width, request.height, signal, progress, request.job);
  }
  async prepare(id: FractalId, arithmetic: 'float32' | 'binary64' = 'float32') {
    await this.library.prepare(id, arithmetic,arithmetic==='binary64'&&(this.precisionExecutor==='registers'||this.precisionExecutor==='compact'));
    if(arithmetic==='binary64'){this.stats.kernelVariant=kernelId(this.library.kernel);this.stats.kernelFallback=this.library.kernelFailure;}
  }
  async preparePreview(request:PreviewPreparation){
    const scene=copyScene(request.scene),generation=this.generation,{width,height}=request;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>this.limits.maxPixels||width>this.capabilities.maxTextureSize||height>this.capabilities.maxTextureSize)throw Error('Этот размер вычислительного поля недоступен.');
    await this.prepare(scene.fractalId);this.ensureActive(generation);
    if(request.arithmetic==='double-single'&&!this.getPreviewUnavailable(scene)){
      try{await this.library.doubleSingle(scene,width,height,scene.iterations<=512);this.ensureActive(generation);}
      catch(error){this.ensureActive(generation);if(error instanceof RenderCancelledError)throw error;this.stats.previewUnavailable=error instanceof Error?error.message:String(error);this.previewFailures.set(this.previewSignature(scene),this.stats.previewUnavailable);}
    }
  }
  verifyArithmetic(...args: Parameters<WebGLPrograms['verifyArithmetic']>) { return this.library.verifyArithmetic(...args); }
  private uniform(program: Program, name: string) { return this.library.uniform(program, name); }
  private ensureActive(generation = this.generation) { if (this.disposed || generation !== this.generation || this.gl.isContextLost()) throw new RenderCancelledError(); }
  getCapabilities() { return { ...this.capabilities }; }
  private readCapabilities() {
    const gl = this.gl, debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: this.stats.renderer, vendor: debug ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)), version: String(gl.getParameter(gl.VERSION)), shadingLanguage: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)), maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)), gpuTimer: this.measurements.available, parallelCompile: !!this.library.parallel };
  }
  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 недоступен. Проверьте аппаратное ускорение и обновите браузер.');
    this.gl = gl;
    this.resources = new WebGLResources(gl);
    this.library = new WebGLPrograms(gl, () => this.generation, generation => this.ensureActive(generation));
    this.library.onYield=()=>this.represent();
    this.measurements = new WebGLMeasurements(gl, this.stats);
    this.readiness = new GpuReadiness(gl,()=>this.generation,()=>this.measurements.poll());
    this.previewCache = new PreviewFieldCache(surface=>{if(!this.gl.isContextLost())disposeFieldSurface(gl,surface);});
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    this.stats.renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'WebGL2 (устройство скрыто браузером)';
    this.capabilities = this.readCapabilities();

  }
  resize(width: number, height: number, surface={width,height}) {
    for(const size of [{width,height},surface])if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width * size.height > 3_000_000 || size.width < 1 || size.height < 1 || size.width > this.capabilities.maxTextureSize || size.height > this.capabilities.maxTextureSize) throw new Error('Этот размер изображения недоступен на устройстве.');
    if (width === this.stats.width && height === this.stats.height && surface.width===this.surface.width && surface.height===this.surface.height) return;
    if(this.computing&&(width!==this.stats.width||height!==this.stats.height))this.cancelRefinement();
    this.surface={...surface};
    this.stats.surfaceWidth=surface.width;this.stats.surfaceHeight=surface.height;
    // Resize the drawing buffer only together with a valid presentation.
    // Offscreen coarse/preview fields never resize this surface.
    this.stats.width = width; this.stats.height = height;
  }
  draw(scene: SceneState, reproject = false, job?: RenderJob) {
    if (this.disposed || this.gl.isContextLost()) return;
    this.presentationScene=copyScene(scene);
    reproject ||= this.isPrecise(scene)||(this.computing&&sameSceneMath(this.fieldScene,scene));
    const gl = this.gl, program = this.library.programs.get(scene.fractalId) ?? (reproject ? this.library.color : null), color = this.library.color;
    if (!program || !color || !this.stats.width) return;
    this.measurements.poll();
    const key = JSON.stringify([sceneMathKey(scene), this.stats.width, this.stats.height]);
    gl.bindVertexArray(this.resources.vao); gl.viewport(0, 0, this.stats.width, this.stats.height);
    let computed=false;
    if (!reproject && key !== this.calculationKey) {
      this.resources.allocate(false, this.stats.width, this.stats.height);
      const source=this.fieldSource(scene,'float32',this.stats.width,this.stats.height,job);this.events.emit('field-submitted',source);
      const query = this.measurements.begin({ ...jobMetadata(job), submittedAt: performance.now(), width: this.stats.width, height: this.stats.height, kind: 'preview' });
      try { floatField(gl, program, (p,n) => this.uniform(p,n), this.resources.framebuffer, this.stats.width, this.stats.height, scene); }
      finally { this.measurements.end(query); }
      this.stats.computations++; this.calculationKey = key;
      this.fieldScene = copyScene(scene); this.stats.arithmetic = 'float32'; this.stats.phase = 'preview'; this.stats.progress = 0;
      this.visibleSource=source;this.readyFieldId=0;
      this.readiness.watch(()=>{if(this.visibleSource?.fieldId===source.fieldId)this.readyFieldId=source.fieldId;this.events.emit('field-ready',source);},reason=>this.events.emit('field-cancelled',source,{reason}));
      this.stats.executor='float32-specialized';
      this.stats.registerCapacity=undefined;this.stats.programRegisters=undefined;
      computed=true;
    }
    const colorQuery = this.measurements.begin({ ...jobMetadata(job), submittedAt: performance.now(), width: this.surface.width, height: this.surface.height, kind: 'color' });
    const camera=this.fieldScene?.camera,target=scene.camera,size=this.resources.frontSize;
    const reprojected=!!camera&&(camera.x!==target.x||camera.y!==target.y||camera.height!==target.height||size.width*this.surface.height!==this.surface.width*size.height);
    try { this.present(scene,computed?'computed':reprojected?'reprojection':'repeat'); }
    finally { this.measurements.end(colorQuery); }
  }
  private represent(){if(this.presentationScene&&!this.disposed&&!this.gl.isContextLost())this.present(this.presentationScene);}
  private present(scene: SceneState,kind:NonNullable<RenderStats['presentationKind']>='repeat',eventKind:PresentationKind=kind) {
    if (!this.visible || this.disposed || this.gl.isContextLost()) return;
    const gl = this.gl, color = this.library.color;
    const saved=this.exportPresentation,resources=saved?.resources??this.resources,fieldScene=saved?saved.fieldScene:this.fieldScene,surface=saved?.surface??this.surface;
    if (!color || !resources.frontSize.width || !fieldScene) return;
    if(saved){scene=saved.scene??fieldScene;kind='repeat';}
    if(this.canvas.width!==surface.width)this.canvas.width=surface.width;
    if(this.canvas.height!==surface.height)this.canvas.height=surface.height;
    colorField(gl,color,(p,n)=>this.uniform(p,n),resources,scene,fieldScene,surface.width,surface.height);
    const size=resources.frontSize;
    gl.drawArrays(gl.TRIANGLES, 0, 3); this.stats.draws++; this.stats.fractalId = scene.fractalId;
    this.stats.computeWidth = size.width; this.stats.computeHeight = size.height;
    this.stats.presentationKind=kind;
    const count=kind==='computed'?'computedDraws':kind==='reprojection'?'reprojectionDraws':kind==='cache'?'cacheDraws':'repeatDraws';this.stats[count]=(this.stats[count]??0)+1;
    const source=saved?saved.source:this.visibleSource;if(source)this.events.emit('presentation',source,{presentation:saved?'repeat':eventKind});
  }
  cancelRefinement() { this.task.abort(new RenderCancelledError());this.stats.previewStartedAt=undefined; }
  hasField() { return !!this.fieldScene; }
  isPrecise(scene: SceneState) { return this.stats.arithmetic === ARITHMETIC_VERSION && this.calculationKey === this.preciseKey(scene); }
  private preciseKey(scene: SceneState,width=this.stats.width,height=this.stats.height) { return 'binary64:' + JSON.stringify([sceneMathKey(scene), width, height,kernelId(this.library.kernel)]); }
  refine(scene: SceneState, progress: (fraction: number) => void = () => {}, signal?: AbortSignal, job?: RenderJob,fieldWidth?:number,fieldHeight?:number,arithmetic:'binary64'|'double-single'='binary64',publication:'progressive'|'atomic'='progressive'): Promise<void> {
    const width=fieldWidth??this.stats.width,height=fieldHeight??this.stats.height;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>this.limits.maxPixels||width>this.capabilities.maxTextureSize||height>this.capabilities.maxTextureSize)return Promise.reject(Error('Этот размер вычислительного поля недоступен.'));
    this.cancelRefinement();
    const task = new AbortController(), previous = this.refinement, snapshot = copyScene(scene);
    this.task = task;
    this.activeField=snapshot;
    const cancel = () => task.abort(signal?.reason ?? new RenderCancelledError());
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const generation = this.generation,extended=arithmetic==='double-single';let source=this.fieldSource(snapshot,arithmetic,width,height,job);
    this.presentationScene=copyScene(snapshot);
    const run = async () => {
      await previous.catch(() => {}); task.signal.throwIfAborted();
      this.computing=true;const preparationStarted=performance.now();
      await abortable(this.prepare(snapshot.fractalId,extended?'float32':'binary64'), task.signal); task.signal.throwIfAborted(); this.ensureActive(generation);
      let published=false,completed=0;
      const current=()=>{task.signal.throwIfAborted();this.ensureActive(generation);};
      const copy=(tile?:FieldTile)=>{
        const gl=this.gl;gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.resources.backFramebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.resources.framebuffer);
        const x=tile?.x??0,y=tile?.y??0,w=tile?.width??width,h=tile?.height??height;
        gl.blitFramebuffer(x,y,x+w,y+h,x,y,x+w,y+h,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      };
      const notify=(complete:boolean,tile?:FieldTile)=>{if(job)for(const listener of this.fieldListeners)listener({job,arithmetic,width,height,progress:complete?1:completed/(width*height),complete,tile});};
      const context:OrbitContext={gl:this.gl,resources:this.resources,programs:this.library,measurements:this.measurements,stats:this.stats,ensureActive:()=>this.ensureActive(generation),canRelease:()=>generation===this.generation&&!this.gl.isContextLost(),present:()=>this.represent(),
        beginField:()=>{
          current();this.stats.preparationMs=performance.now()-preparationStarted;
          source={...source,submittedAt:performance.now()};
          this.events.emit('field-submitted',source);
          if(extended){this.stats.previewStartedAt=performance.now();this.stats.previewCompletedAt=undefined;this.stats.previewLatencyMs=undefined;}
          const gl=this.gl;
          if(publication!=='atomic'&&this.fieldScene&&this.fieldScene.fractalId===snapshot.fractalId&&this.fieldScene.formulaVersion===snapshot.formulaVersion&&JSON.stringify(this.fieldScene.parameters)===JSON.stringify(snapshot.parameters)){
            const program=this.library.programs.get('@field-projection')!;gl.bindVertexArray(this.resources.vao);gl.bindFramebuffer(gl.FRAMEBUFFER,this.resources.backFramebuffer);gl.viewport(0,0,width,height);gl.useProgram(program.handle);
            fieldProjection(gl,program,(p,n)=>this.uniform(p,n),this.resources,snapshot,this.fieldScene!,width,height);gl.drawArrays(gl.TRIANGLES,0,3);
          }else{gl.bindFramebuffer(gl.FRAMEBUFFER,this.resources.backFramebuffer);gl.clearColor(0,0,0,254/255);gl.clear(gl.COLOR_BUFFER_BIT);}
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        },publishTile:tile=>{
          current();completed+=tile.width*tile.height;
          if(publication==='atomic'){progress(completed/(width*height));return;}
          if(!published){this.resources.allocate(false,width,height);copy();published=true;}else copy(tile);
          this.fieldScene=copyScene(snapshot);this.calculationKey='partial:'+this.preciseKey(snapshot);this.stats.arithmetic=extended?DOUBLE_SINGLE_VERSION:'mixed-binary64-preview';
          this.visibleSource=source;this.readyFieldId=0;this.events.emit('tile-published',source,{tile});
          this.present(this.presentationScene??snapshot,'computed','tile');notify(false,tile);
        }};
      const started=extended&&snapshot.iterations<=512
        ?await flatPreview(context,snapshot,width,height,task.signal,job)
        :await binary64Field(context,snapshot,width,height,task.signal,progress,job,{arithmetic,executor:extended?'queue':this.precisionExecutor,targetMs:extended?undefined:this.precisionBudget,onActivity:sample=>{for(const listener of this.activityListeners)listener(sample);}});
      task.signal.throwIfAborted(); this.ensureActive(generation);
      if(publication==='atomic')this.resources.swap();
      if(extended&&this.stats.previewStartedAt!=null){this.stats.previewCompletedAt=performance.now();this.stats.previewLatencyMs=this.stats.previewCompletedAt-this.stats.previewStartedAt;this.stats.previewStartedAt=undefined;}
      this.fieldScene=snapshot; this.calculationKey=extended?this.preciseKey(snapshot,width,height).replace('binary64:','double-single:'):this.preciseKey(snapshot,width,height);
      this.stats.arithmetic=extended?DOUBLE_SINGLE_VERSION:ARITHMETIC_VERSION; this.stats.phase=extended?'preview':'precise'; this.stats.progress=1;
      this.stats.timeUntilPreciseMs=extended?null:performance.now()-started; this.stats.computations++;
      this.visibleSource=source;this.readyFieldId=source.fieldId;this.events.emit('field-ready',source);
      // The last published region already presented the complete field. Only
      // clients without progressive publication need a completion presentation.
      if(!published)this.present(this.presentationScene??snapshot,'computed');notify(true);
    };
    this.refinement = run().catch(error=>{if(generation===this.generation&&!this.disposed)this.events.emit('field-cancelled',source,{reason:String(error)});throw error;}).finally(() => {signal?.removeEventListener('abort', cancel);if(this.task===task){this.computing=false;this.activeField=null;this.stats.previewStartedAt=undefined;}});
    return this.refinement;
  }
  resetMeasurement() { this.measurements.reset(); }
  async captureViewingField(scene:SceneState,width:number,height:number,signal?:AbortSignal):Promise<Blob>{
    const gl=this.gl,generation=this.generation;
    this.ensureActive(generation);signal?.throwIfAborted();
    if(!this.fieldScene||!this.library.color||!sameSceneMath(this.fieldScene,scene)||this.resources.frontSize.width!==width||this.resources.frontSize.height!==height)throw Error('Актуальное поле просмотра ещё не готово.');
    const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
    if(!texture||!framebuffer){if(texture)gl.deleteTexture(texture);if(framebuffer)gl.deleteFramebuffer(framebuffer);throw Error('Не удалось выделить память PNG.');}
    this.captureBytes=width*height*12; // target RGBA8 + readback + flipped CPU copy
    try{
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Этот размер PNG недоступен.');
      colorField(gl,this.library.color,(p,n)=>this.uniform(p,n),this.resources,scene,this.fieldScene,width,height);
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.drawArrays(gl.TRIANGLES,0,3);
      const bytes=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);this.represent();
      const blob=await encodePng(bytes,width,height);this.ensureActive(generation);signal?.throwIfAborted();return blob;
    }finally{
      this.captureBytes=0;
      if(!this.disposed&&generation===this.generation&&!gl.isContextLost()){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);}
    }
  }
  /** Diagnostic readback only; not used by navigation or coloring. */
  readPoint(x: number, y: number) {
    const gl = this.gl, bytes = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resources.framebuffer);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const outcome = decodeOutcome(bytes);
    return { ...outcome, escaped: outcome.status === 'escaped' };
  }
  async export(scene: SceneState, width: number, height: number, signal?: AbortSignal, progress?: (fraction: number) => void, job?: RenderJob): Promise<Blob> {
    const snapshot = copyScene(scene), gl = this.gl, generation = this.generation;
    this.ensureActive(generation);
    const previous = { width: this.stats.width, height: this.stats.height,surface:{...this.surface} };
    const screen={resources:this.resources,scene:this.fieldScene,key:this.calculationKey,presentation:this.presentationScene,source:this.visibleSource,readyFieldId:this.readyFieldId,stats:{...this.stats}};
    let key="";
    let completed=false;
    try {
      signal?.throwIfAborted();
      const preparation=this.prepare(snapshot.fractalId,'binary64');
      await (signal?abortable(preparation,signal):preparation);
      this.ensureActive(generation);signal?.throwIfAborted();
      key=this.preciseKey(snapshot,width,height);
      if(this.cachedExport?.key!==key)this.invalidateExportCache();
      const cached=this.cachedExport;this.cachedExport=null;
      this.exportScreenResources=this.resources;
      this.exportPresentation={resources:screen.resources,fieldScene:screen.scene,scene:screen.presentation,surface:previous.surface,source:screen.source};
      this.resources=cached?.resources??new WebGLResources(gl);
      this.fieldScene=cached?copyScene(cached.scene):null;this.calculationKey=cached?.key??'';
      this.stats.arithmetic=cached?ARITHMETIC_VERSION:'float32';
      this.resize(width,height);
      if(!this.isPrecise(snapshot))await this.refine(snapshot,progress,signal,job);else progress?.(1);
      this.ensureActive(generation);signal?.throwIfAborted();
      completed=true;
      const bytes = new Uint8Array(width * height * 4);
      // Export coloring/readback and screen restoration are one synchronous
      // submission. No export-sized surface is presented across an await.
      if(this.canvas.width!==width)this.canvas.width=width;
      if(this.canvas.height!==height)this.canvas.height=height;
      colorField(gl,this.library.color!,(p,n)=>this.uniform(p,n),this.resources,snapshot,this.fieldScene!,width,height);
      gl.drawArrays(gl.TRIANGLES,0,3);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      this.represent();
      this.ensureActive(generation);
      const blob = await encodePng(bytes, width, height);
      this.ensureActive(generation); signal?.throwIfAborted();
      return blob;
    } finally {
      if (!this.disposed && generation === this.generation && !gl.isContextLost()) {
        if(this.exportScreenResources===screen.resources){
          const resources=this.resources;
          this.resources=screen.resources;this.exportScreenResources=null;this.exportPresentation=null;
          if(completed)this.cachedExport={resources,scene:copyScene(snapshot),key,width,height};else resources.dispose();
          this.fieldScene=screen.scene;this.calculationKey=screen.key;this.presentationScene=screen.presentation;
          this.visibleSource=screen.source;this.readyFieldId=screen.readyFieldId;
          const {draws,computations,computedDraws,reprojectionDraws,repeatDraws,gpuMs,gpuSample,gpuSampleId}=this.stats;
          Object.assign(this.stats,screen.stats,{draws,computations,computedDraws,reprojectionDraws,repeatDraws,gpuMs,gpuSample,gpuSampleId});
        }
        if(previous.width){this.resize(previous.width, previous.height,previous.surface);this.represent();}
      }
    }
  }
  restore() {
    if(this.disposed)return;
    this.readiness.clear(false);this.previewCache.abandon();this.visibleSource=null;this.readyFieldId=0;
    this.cancelRefinement(); this.generation++;this.exportScreenResources=null;this.exportPresentation=null;this.cachedExport=null;this.previewFailures.clear(); this.library.restore(); this.measurements.restore();
    this.stats.previewStartedAt=undefined;this.stats.previewCompletedAt=undefined;this.stats.previewLatencyMs=undefined;
    this.stats.previewGenerator=undefined;this.stats.previewGeneratorFallback=undefined;this.stats.compactionUnavailable=undefined;this.stats.compactions=undefined;this.stats.activePixels=undefined;this.stats.activeOriginalPixels=undefined;
    this.stats.activityProbes=undefined;this.stats.activitySubmitMs=undefined;this.stats.activityWaitMs=undefined;this.stats.activityReadMs=undefined;this.stats.activityDrainMs=undefined;this.stats.activityLatencyMs=undefined;
    const debug=this.gl.getExtension('WEBGL_debug_renderer_info');this.stats.renderer=debug?String(this.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)):'WebGL2 (устройство скрыто браузером)';
    this.capabilities=this.readCapabilities();this.resources.initialize();this.fieldScene=null;this.calculationKey='';this.stats.width=0;this.stats.height=0;this.stats.fractalId=null;this.stats.previewUnavailable=undefined;this.stats.computeWidth=0;this.stats.computeHeight=0;this.stats.arithmetic='float32';this.stats.phase='preview';this.stats.progress=0;this.stats.timeUntilPreciseMs=null;this.computing=false;
  }
  /** Only exposed through the diagnostic harness; absent from RenderBackend. */
  getContext() { return this.gl; }
  dispose() {
    if(this.disposed)return;
    this.cancelRefinement();this.readiness.clear();this.clearPreviewCache();this.events.dispose(); this.disposed=true;
    this.fieldListeners.clear();this.activityListeners.clear();
    const gl=this.gl;gl.useProgram(null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.bindTexture(gl.TEXTURE_2D,null);
    this.library.dispose();this.resources.dispose();this.exportScreenResources?.dispose();this.exportScreenResources=null;this.exportPresentation=null;this.invalidateExportCache();this.measurements.dispose();
  }
}
/** Compatibility entry point for isolated numerical/thumbnail scripts. */
export { WebGLBackend as FractalRenderer };
const jobMetadata=(job?:RenderJob)=>job?{jobId:job.id,sceneRevision:job.sceneRevision,contextGeneration:job.contextGeneration}:{};
