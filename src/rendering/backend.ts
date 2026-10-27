import type { FractalId, SceneState } from '../domain/types';
import type { GpuMeasurement } from '../domain/quality';
import type { Arithmetic } from '../domain/renderPolicy';
import type { RenderLimits } from '../domain/renderLimits';
import type { RenderJob } from './jobs';
import type {FieldTile} from '../domain/fieldTiles';
import type { RenderEvent, RenderCounters } from '../domain/renderEvents';
import type { ResourceMode } from '../domain/resources';
import type { PreviewFieldDescriptor } from '../domain/previewCache';

export class RenderCancelledError extends Error {
  constructor() { super('Подготовка изображения прервана.'); this.name = 'RenderCancelledError'; }
}
export interface RenderStats {
  surfaceWidth?:number;surfaceHeight?:number;
  draws: number; computations: number; width: number; height: number; gpuMs: number | null; renderer: string; fractalId: FractalId | null;
  gpuSampleId: number; gpuSample: GpuMeasurement | null; arithmetic: string; phase: 'preview' | 'refining' | 'precise' | 'unavailable'; progress: number;
  computeWidth: number; computeHeight: number; timeUntilPreciseMs: number | null;
  tileTiming?: 'gpu' | 'fence' | 'pending'; tileLatencyMs?: number; tilePolls?: number; tilePixels?: number; fenceBaselineMs?: number;
  executor?:string;submittedSlices?:number;maxQueuedSlices?:number;waitMs?:number;preparationMs?:number;
  kernelVariant?:string;kernelFallback?:string;
  activePixels?:number;activeOriginalPixels?:number;compactions?:number;compactionUnavailable?:string;
  /** Host elapsed timings; these are not GPU execution times. */
  activityProbes?:number;activitySubmitMs?:number;activityWaitMs?:number;activityReadMs?:number;activityDrainMs?:number;
  /** Sum of counter lifetimes, including overlap with orbit work; not additive to waitMs. */
  activityLatencyMs?:number;
  previewGenerator?:string;previewGeneratorFallback?:string;
  /** Slots in the software interpreter, not physical GPU registers. */
  registerCapacity?:number;programRegisters?:number;
  /** Wall-clock preview operation latency, excluding preparation; never GPU time. */
  previewStartedAt?:number;previewCompletedAt?:number;previewLatencyMs?:number;
  computedDraws?:number;reprojectionDraws?:number;repeatDraws?:number;cacheDraws?:number;presentationKind?:'computed'|'reprojection'|'repeat'|'cache';previewUnavailable?:string;
}
export interface BackendCapabilities {
  renderer: string; vendor: string; version: string; shadingLanguage: string; maxTextureSize: number; gpuTimer: boolean; parallelCompile: boolean;
}
export interface FieldUpdate {job:RenderJob;arithmetic:'double-single'|'binary64';width:number;height:number;progress:number;complete:boolean;tile?:FieldTile}
export interface FieldRequest { scene: SceneState; job: RenderJob; reproject?: boolean; arithmetic?:'float32'|'double-single';interactive?:boolean;width?:number;height?:number;waitForCompletion?:boolean;publication?:'progressive'|'atomic';progress?: (fraction: number) => void }
export interface PreviewPreparation {scene:SceneState;arithmetic:'float32'|'double-single';width:number;height:number}
export interface ExportRequest { scene: SceneState; width: number; height: number; arithmetic: Arithmetic; job: RenderJob }
export interface RenderBackend {
  readonly limits: RenderLimits;
  getSnapshot(): Readonly<RenderStats>;
  getPreviewUnavailable?(scene: SceneState): string | undefined;
  invalidateExportCache?(): void;
  getCapabilities(): Readonly<BackendCapabilities>;
  getMemoryEstimate(): { fieldBytes: number; instructionBytes: number; scratchBytes?: number; captureCpuBufferBytes?:number; previewCacheBytes?:number;previewCacheEntries?:number;previewCacheUnavailable?:boolean };
  subscribeRenderEvents?(listener:(event:RenderEvent)=>void):()=>void;
  getRenderCounters?():RenderCounters;
  drainGpuMeasurements?(maxMs:number,signal?:AbortSignal):Promise<void>;
  configurePreviewCache?(mode:ResourceMode,enabled:boolean):void;
  clearPreviewCache?():void;
  retainPreviewField?(field:PreviewFieldDescriptor):void;
  isPreviewFieldReady?(field:PreviewFieldDescriptor):boolean;
  restorePreviewField?(field:PreviewFieldDescriptor,job:RenderJob):boolean;
  previewArithmeticVersion?(arithmetic:'float32'|'double-single'):string;
  isContextLost(): boolean;
  /** Suppress surface presentations while hidden; submitted compilation may finish. */
  setVisible(visible: boolean): void;
  prepare(id: FractalId, arithmetic?: 'float32'|'binary64'): Promise<void>;
  preparePreview?(request:PreviewPreparation):Promise<void>;
  resize(width: number, height: number, surface?: {width:number;height:number}): void;
  preview(request: FieldRequest): void|Promise<void>;
  subscribeFields?(listener:(update:FieldUpdate)=>void):()=>void;
  subscribeMeasurements?(listener:(sample:GpuMeasurement)=>void):()=>void;
  recolor(scene: SceneState, job?: RenderJob): void;
  refineField(request: FieldRequest, signal?: AbortSignal): Promise<void>;
  cancelRefinement(): void;
  hasField(): boolean;
  isPrecise(scene: SceneState): boolean;
  exportFrame(request: ExportRequest, signal?: AbortSignal, progress?: (fraction: number) => void): Promise<Blob>;
  captureViewingField?(scene: SceneState, width:number, height:number, signal?: AbortSignal): Promise<Blob>;
  resetMeasurement(): void;
  restore(): void;
  dispose(): void;
}
