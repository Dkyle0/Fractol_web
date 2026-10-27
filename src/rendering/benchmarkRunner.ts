import { benchmarkCases, benchmarkScene, BenchmarkSamples, percentile, BENCHMARK_METHOD, BENCHMARK_TIMING, type BenchmarkCase, type BenchmarkConfig, type BenchmarkReport } from '../domain/benchmark';
import { RenderEventSamples } from '../domain/renderEventSamples';
import { collectDeviceInfo } from '../infrastructure/device';
import type { RenderSession, OperationLease } from './session';
import { benchmarkPreviewPolicy } from '../domain/renderPolicy';
import { version } from '../../package.json';
import {copyScene} from '../domain/types';
import {resourcePolicies} from '../domain/resources';

export interface BenchmarkProgress { index: number; total: number; fraction: number; phase: string }
export interface BenchmarkHost {
  apply(test: BenchmarkCase): Promise<void>; move(scene: BenchmarkCase['scene']): void; isLight(): boolean;
  panels: string; progress(value: BenchmarkProgress): void;
}
export class BenchmarkRunner {
  private aborter = new AbortController();
  stop(reason = 'Остановлен пользователем.') { if (!this.aborter.signal.aborted) this.aborter.abort(reason); }
  constructor(private scheduler: RenderSession, private host: BenchmarkHost) {}
  async run(config: BenchmarkConfig): Promise<BenchmarkReport> {
    const lease=this.scheduler.acquireOperation('benchmark');
    const stopped=()=>this.stop(lease.signal.reason instanceof Error?lease.signal.reason.message:String(lease.signal.reason));
    lease.signal.addEventListener('abort',stopped,{once:true});
    try { return await this.runWithLease(config,lease); }
    finally { lease.signal.removeEventListener('abort',stopped);lease.release(); }
  }
  private async runWithLease(config: BenchmarkConfig, lease: OperationLease): Promise<BenchmarkReport> {
    const signal = this.aborter.signal;
    const qualityProfile = config.mode === 'standard' ? 'auto' : config.qualityProfile ?? this.scheduler.getQualityProfile();
    const resourceMode=config.mode==='standard'?'standard':config.resourceMode??this.scheduler.getResourceMode();
    this.scheduler.setResourceMode(resourceMode,true);
    this.scheduler.setQualityProfile(qualityProfile);
    lease.setPolicy(benchmarkPreviewPolicy);
    let lastProgress = -Infinity, progressTimer: ReturnType<typeof setTimeout> | undefined;
    const progress = (value: BenchmarkProgress) => {
      clearTimeout(progressTimer);
      const publish = () => { lastProgress = performance.now(); this.host.progress(value); };
      const remaining = 250 - (performance.now() - lastProgress);
      if (remaining <= 0) publish(); else progressTimer = setTimeout(publish, remaining);
    };
    const stopResize = () => this.stop('Размер окна или DPR изменился. Запустите тест заново.');
    const stopHidden = () => { if (document.hidden) this.stop('Вкладка скрыта. Запустите тест в активной вкладке.'); };
    const unsubscribe = this.scheduler.onFailure(reason => this.stop(reason));
    window.addEventListener('resize', stopResize); document.addEventListener('visibilitychange', stopHidden);
    try {
    const viewport = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio };
    const report: BenchmarkReport = { version: 1, appVersion: version, qualityProfile,resourceMode,targetFps:resourcePolicies[resourceMode].targetFps,renderLimits:this.scheduler.getRenderLimits(), method: BENCHMARK_METHOD, startedAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, mode: config.mode, status: 'interrupted', reason: '', device: await collectDeviceInfo(this.scheduler.getCapabilities()), results: [], timing: { ...BENCHMARK_TIMING }, panels: this.host.panels, comment: '', deviceLabel: '', processorLabel: '' };
    try {
      if (document.hidden) this.stop('Вкладка скрыта.');
      const cases = benchmarkCases(config);
      for (const [index, test] of cases.entries()) {
        lease.setPolicy(benchmarkPreviewPolicy);
        if (signal.aborted) break;
        progress({ index, total: cases.length, fraction: 0, phase: 'Подготовка шейдеров' });
        const preparationStarted=performance.now();
        await this.host.apply(test);
        if (signal.aborted) break;
        this.scheduler.resetMeasurement();
        const timeout = setTimeout(() => this.stop('Подготовка шейдеров заняла больше 30 секунд.'), 30_000);
        try { await this.abortable(this.scheduler.prepare(test.scene.fractalId)); }
        finally { clearTimeout(timeout); }
        const preparationMs=performance.now()-preparationStarted;
        if (signal.aborted) break;
        const motionBase=copyScene(test.scene);
        motionBase.camera=this.scheduler.getViewState().camera;
        let samples = new BenchmarkSamples(this.scheduler.getStats().gpuSampleId,this.scheduler.getStats().computations), measured = false, elapsed = 0;
        let eventSamples:RenderEventSamples|null=null,measurementStarted:number|null=null,measurementEnded:number|null=null;
        const capture={window:null as RenderEventSamples|null};
        let origin:number|null = null, lastFrameProgress = -Infinity, frame = 0;
        const { warmupMs, measureMs } = BENCHMARK_TIMING;
        const off = this.scheduler.subscribe(sample => {
          if (measured && measurementStarted!==null && sample.timestamp >= measurementStarted) samples.add(sample);
        });
        const offEvents=this.scheduler.subscribeRenderEvents(event=>capture.window?.add(event));
        const offGpu = this.scheduler.subscribeGpuMeasurements(sample => {
          capture.window?.addGpu(sample);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const abort = () => { cancelAnimationFrame(frame); reject(new Error(String(signal.reason))); };
            signal.addEventListener('abort', abort, { once: true });
            const step = (now: number) => {
              if (signal.aborted) { abort(); return; }
              if (innerWidth !== viewport.width || innerHeight !== viewport.height || devicePixelRatio !== viewport.dpr) { stopResize(); return; }
              const observed=performance.now();if (origin===null) origin = observed;
              elapsed = observed - origin;
              if (!measured && measurementStarted===null && elapsed >= warmupMs) {
                measured = true;measurementStarted=observed;this.scheduler.resetGpuMeasurement();
                samples = new BenchmarkSamples(this.scheduler.getStats().gpuSampleId,this.scheduler.getStats().computations);
                eventSamples=new RenderEventSamples(observed,this.scheduler.getRenderCounters());capture.window=eventSamples;
              }
              if (now - lastFrameProgress >= 250) { progress({ index, total: cases.length, fraction: Math.min(1, elapsed / (warmupMs + measureMs)), phase: elapsed < warmupMs ? 'Прогрев' : 'Измерение' }); lastFrameProgress = now; }
              if (measurementStarted!==null && observed-measurementStarted >= measureMs) {
                measurementEnded=observed;measured=false;eventSamples?.close(observed,this.scheduler.getRenderCounters());
                signal.removeEventListener('abort', abort); resolve(); return;
              }
              this.host.move(benchmarkScene(motionBase, elapsed)); this.scheduler.interact();
              frame = requestAnimationFrame(step);
            };
            frame = requestAnimationFrame(step);
          });
        } finally {
          cancelAnimationFrame(frame);off();measured=false;
          if(measurementStarted!==null&&measurementEnded===null){measurementEnded=performance.now();capture.window?.close(measurementEnded,this.scheduler.getRenderCounters());}
          const drainStarted=performance.now();
          try{if(!signal.aborted)await this.scheduler.drainGpuMeasurements(500,signal);}catch(error){this.stop(String(error));}finally{offEvents();offGpu();}
          const gpuDrainMs=performance.now()-drainStarted,settleStarted=performance.now();
          if(!signal.aborted){
            progress({index,total:cases.length,fraction:1,phase:'Ожидание итогового поля'});
            try{await this.scheduler.waitForViewingField(signal);}catch(error){this.stop(String(error));}
          }
          const settleMs=performance.now()-settleStarted;
          const measurement=capture.window?.result(true),durationMs=measurement?.durationMs??0;
          const base=samples.result(test,durationMs,!test.lightGlass&&this.host.isLight(),signal.aborted?'interrupted':'completed',config.includeSamples);
          if(measurement){
            base.measurement=measurement;base.completedFields=measurement.completedFields;
            base.newFieldsPerSecond=durationMs>0?measurement.completedFields*1000/durationMs:0;
            base.p95FieldMs=percentile(measurement.fieldIntervalsMs,.95);base.fieldIntervalsMs=[...measurement.fieldIntervalsMs];
            base.presentations={...measurement.presentations};base.frames=Object.values(measurement.presentations).reduce((a,b)=>a+b,0);
            base.updatesPerSecond=durationMs>0?base.frames*1000/durationMs:0;
            base.p50FrameMs=percentile(measurement.presentationIntervalsMs,.5);base.p95FrameMs=percentile(measurement.presentationIntervalsMs,.95);
            base.gpuSamples=measurement.gpuSamples;base.p50GpuMs=percentile(measurement.gpuTimesMs,.5);base.p95GpuMs=percentile(measurement.gpuTimesMs,.95);
            if(config.includeSamples){base.frameIntervalsMs=[...measurement.presentationIntervalsMs];base.gpuTimesMs=[...measurement.gpuTimesMs];}
          }
          report.results.push({...base,preparationMs,warmupDurationMs:measurementStarted===null?elapsed:measurementStarted-(origin??measurementStarted),gpuDrainMs,settleMs,settledFieldStatus:signal.aborted?'interrupted':'ready',viewingScene:motionBase});
        }

      }
      report.status = signal.aborted ? 'interrupted' : 'completed';
      report.reason = signal.aborted ? String(signal.reason) : '';
    } catch (cause) { report.reason = signal.aborted ? String(signal.reason) : cause instanceof Error ? cause.message : 'Ошибка бенчмарка.'; }
    return report;
    } finally { clearTimeout(progressTimer); unsubscribe(); window.removeEventListener('resize', stopResize); document.removeEventListener('visibilitychange', stopHidden); }
  }
  private abortable<T>(promise: Promise<T>): Promise<T> {
    const signal = this.aborter.signal;
    return new Promise((resolve, reject) => {
      if (signal.aborted) { void promise.catch(() => {}); reject(new Error(String(signal.reason))); return; }
      const abort = () => reject(new Error(String(signal.reason)));
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
}
