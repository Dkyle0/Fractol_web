import { createScene } from './catalog';
import { copyScene, type SceneState } from './types';
import type { QualityProfile, GpuMeasurement } from './quality';
import type {ResourceMode} from './resources';
import type {RenderLimits} from './renderLimits';
import type { RenderMeasurement } from './renderEventSamples';
export interface BenchmarkFrame { timestamp: number; stats: { scale: number; width: number; height: number;computeWidth?:number;computeHeight?:number; computations?:number;gpuSampleId: number; gpuMs: number | null; arithmetic?: string;executor?:string;previewGenerator?:string;presentationKind?:'computed'|'reprojection'|'repeat'|'cache';viewing?:{effectiveIterations:number;overview:boolean;camera:SceneState['camera']} } }

export const BENCHMARK_METHOD = 'fractol-navigation-v6-events';
export const BENCHMARK_TIMING = { warmupMs: 2000, measureMs: 10000 };
export interface BenchmarkConfig { mode: 'standard' | 'current'; scene: SceneState; qualityProfile?: QualityProfile; resourceMode?:ResourceMode; includeSamples?: boolean }
export interface BenchmarkCase { scene: SceneState; lightGlass: boolean }
export interface DeviceInfo {
  browser: string; userAgent: string; platform: string; architecture: string | null; model: string | null;
  logicalProcessors: number | null; memoryGiB: number | null; screen: { width: number; height: number }; viewport: { width: number; height: number; dpr: number };
  webgl: { renderer: string; vendor: string; version: string; shadingLanguage: string; maxTextureSize: number; gpuTimer: boolean; parallelCompile: boolean };
}
export interface BenchmarkResult extends BenchmarkCase {
  status: 'completed' | 'interrupted'; durationMs: number; frames: number; updatesPerSecond: number;
  p50FrameMs: number | null; p95FrameMs: number | null; p50GpuMs: number | null; p95GpuMs: number | null;
  gpuSamples: number; minScale: number | null; maxScale: number | null; resolutions: string[]; glassReduced: boolean;
  frameIntervalsMs?: number[]; gpuTimesMs?: number[];
  arithmeticModes?: string[];
  effectiveIterations?: number[];
  completedFields?:number;newFieldsPerSecond?:number;p95FieldMs?:number|null;fieldIntervalsMs?:number[];
  viewingCameras?: SceneState['camera'][];
  viewingScene?:SceneState;
  executors?:string[];
  previewGenerators?:string[];
  presentations?:{computed:number;reprojection:number;repeat:number;tile?:number;cache?:number};
  measurement?:RenderMeasurement;
  preparationMs?:number;warmupDurationMs?:number;gpuDrainMs?:number;settleMs?:number;settledFieldStatus?:'ready'|'interrupted';
  precision?: { arithmetic: string; status: 'completed' | 'interrupted'; reason: string; durationMs: number; computeResolution: string; displayResolution: string; scene: SceneState; gpuSamples: number; p50GpuMs: number | null; p95GpuMs: number | null; gpuTimesMs?: number[];executor?:string;kernelVariant?:string;kernelFallback?:string;preparationMs?:number;waitMs?:number;submittedSlices?:number;maxQueuedSlices?:number;compactions?:number;activePixels?:number;activeOriginalPixels?:number };
}
export interface BenchmarkReport {
  version: 1; appVersion: string; method: string; startedAt: string; timeZone: string; mode: BenchmarkConfig['mode'];
  status: 'completed' | 'interrupted'; reason: string; device: DeviceInfo; results: BenchmarkResult[];
  timing: typeof BENCHMARK_TIMING; panels: string; comment: string; deviceLabel: string; processorLabel: string;
  qualityProfile: QualityProfile; resourceMode?:ResourceMode; targetFps?:number; renderLimits?:RenderLimits;
  arithmeticVersion?: string;
}
export function benchmarkCases(config: BenchmarkConfig): BenchmarkCase[] {
  const scenes = config.mode === 'current' ? [copyScene(config.scene)] : (['mandelbrot', 'julia', 'burning-ship'] as const).map(id => createScene(id));
  return [false, true].flatMap(lightGlass => scenes.map(scene => ({ scene: copyScene(scene), lightGlass })));
}
export function benchmarkScene(base: SceneState, elapsedMs: number): SceneState {
  const scene = copyScene(base);
  scene.camera.x = Math.max(-20, Math.min(20, base.camera.x + Math.sin(elapsedMs / 900) * base.camera.height * .035));
  scene.camera.y = Math.max(-20, Math.min(20, base.camera.y + (Math.cos(elapsedMs / 1200) - 1) * base.camera.height * .025));
  return scene;
}
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}
export class BenchmarkSamples {
  private times: number[] = [];
  private fieldTimes:number[]=[];
  private completedFields=0;
  private lastComputations:number;
  private gpu: number[] = [];
  private scales: number[] = [];
  private resolutions = new Set<string>();
  private arithmeticModes = new Set<string>();
  private effectiveIterations = new Set<number>();
  private viewingCameras = new Map<string,SceneState['camera']>();
  private executors=new Set<string>();
  private previewGenerators=new Set<string>();
  private presentations={computed:0,reprojection:0,repeat:0,cache:0};
  private gpuIds = new Set<number>();
  constructor(private initialGpuId = 0,initialComputations=0) { this.lastComputations=initialComputations; }
  /** Queries are delivered independently of presentations; color-only queries
   * are deliberately excluded from the compute portion distribution. */
  addGpu(sample: GpuMeasurement) {
    if (sample.id <= this.initialGpuId || this.gpuIds.has(sample.id)) return;
    this.gpuIds.add(sample.id);
    if ((sample.kind === 'preview' || sample.kind === 'precision') && Number.isFinite(sample.ms) && sample.ms >= 0) this.gpu.push(sample.ms);
  }
  add({ timestamp, stats }: BenchmarkFrame) {
    if (this.times.length && timestamp <= this.times[this.times.length - 1]!) return;
    this.times.push(timestamp); this.scales.push(stats.scale); this.resolutions.add(`${stats.computeWidth || stats.width}×${stats.computeHeight || stats.height}`);
    if(stats.computations!=null&&stats.computations>this.lastComputations){this.completedFields+=stats.computations-this.lastComputations;this.fieldTimes.push(timestamp);this.lastComputations=stats.computations;}
    this.arithmeticModes.add(stats.arithmetic ?? 'float32');
    if(stats.viewing){this.effectiveIterations.add(stats.viewing.effectiveIterations);if(stats.viewing.overview)this.viewingCameras.set(JSON.stringify(stats.viewing.camera),{...stats.viewing.camera});}
    if(stats.executor)this.executors.add(stats.executor);
    if(stats.previewGenerator)this.previewGenerators.add(stats.previewGenerator);
    this.presentations[stats.presentationKind??'computed']++;
  }
  result(test: BenchmarkCase, durationMs: number, glassReduced: boolean, status: BenchmarkResult['status'], includeSamples = false): BenchmarkResult {
    const intervals = this.times.slice(1).map((time, i) => time - this.times[i]!);
    const fieldIntervals=this.fieldTimes.slice(1).map((time,i)=>time-this.fieldTimes[i]!);
    return { completedFields:this.completedFields,newFieldsPerSecond:durationMs>0?this.completedFields*1000/durationMs:0,p95FieldMs:percentile(fieldIntervals,.95),...(includeSamples?{fieldIntervalsMs:fieldIntervals}:{}),...(includeSamples ? { frameIntervalsMs: intervals, gpuTimesMs: [...this.gpu] } : {}), arithmeticModes: [...this.arithmeticModes],effectiveIterations:[...this.effectiveIterations],viewingCameras:[...this.viewingCameras.values()],executors:[...this.executors],previewGenerators:[...this.previewGenerators],presentations:{...this.presentations}, ...test, scene: copyScene(test.scene), status, durationMs, frames: this.times.length, updatesPerSecond: durationMs > 0 ? this.times.length * 1000 / durationMs : 0, p50FrameMs: percentile(intervals, .5), p95FrameMs: percentile(intervals, .95), p50GpuMs: percentile(this.gpu, .5), p95GpuMs: percentile(this.gpu, .95), gpuSamples: this.gpu.length, minScale: this.scales.length ? Math.min(...this.scales) : null, maxScale: this.scales.length ? Math.max(...this.scales) : null, resolutions: [...this.resolutions], glassReduced };
  }
}
