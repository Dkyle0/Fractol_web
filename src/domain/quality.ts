export type QualityProfile = 'auto' | 'performance' | 'quality';
export const qualityProfiles = {
  auto: { name: 'Авто', initial: .65, min: .35, max: 1, description: 'Баланс чёткости и плавности. Разрешение подстраивается во время движения.' },
  performance: { name: 'Плавность', initial: .5, min: .35, max: .75, description: 'Меньше разрешение во время движения, полная чёткость после остановки.' },
  quality: { name: 'Качество', initial: 1, min: 1, max: 1, description: 'Всегда полная чёткость и выбранное стекло. Частота кадров может снизиться.' },
} as const;
export const isQualityProfile = (value: unknown): value is QualityProfile => value === 'auto' || value === 'performance' || value === 'quality';
export interface GpuMeasurement { id: number; ms: number; submittedAt: number; width: number; height: number; kind?: 'preview' | 'precision' | 'color'; stage?:'orbit-state'|'completion'|'active-scan'|'active-pack'|'active-scatter'|'publish'; pixels?: number; iterationSteps?: number; jobId?: number; sceneRevision?: number; contextGeneration?: number }
export interface QualityState {
  profile: QualityProfile; scale: number; frameMs: number | null; lastFrame: number | null;
  decisionAt: number | null; intervals: number; gpu: GpuMeasurement[]; seenGpuId: number;
  overloadedSince: number | null; glassReduced: boolean;
}
export function createQualityState(profile: QualityProfile = 'auto', seenGpuId = 0, glassReduced = false): QualityState {
  return { profile, scale: qualityProfiles[profile].initial, frameMs: null, lastFrame: null, decisionAt: null, intervals: 0, gpu: [], seenGpuId, overloadedSince: null, glassReduced };
}
export function nextRenderScale(scale: number, frameMs: number, gpuMs: number | null, profile: QualityProfile = 'auto', economy = false) {
  const { min, max } = qualityProfiles[profile];
  let next = scale;
  if (frameMs > (economy ? 40 : 21) || (gpuMs != null && gpuMs > (economy ? 12 : 17))) next -= .1;
  else if (frameMs < (economy ? 35 : 18) && (gpuMs == null || gpuMs < (economy ? 6 : 11))) next += .05;
  return Math.max(min, Math.min(max, Math.round(next * 100) / 100));
}
const fresh = (gpu: GpuMeasurement, now: number, width: number, height: number) =>
  gpu.kind!=='color'&&gpu.kind!=='precision'&&Number.isFinite(gpu.ms) && gpu.ms >= 0 && Number.isFinite(gpu.submittedAt) && now >= gpu.submittedAt && now - gpu.submittedAt <= 250 && gpu.width === width && gpu.height === height;
/** Pure transition: rAF cadence, not the frequency of input events, drives adaptation. */
export function advanceQuality(state: QualityState, now: number, width: number, height: number, gpu: GpuMeasurement | null,renderLatencyMs:number|null=null,economy=false): QualityState {
  const next = { ...state };
  if (gpu && gpu.id > next.seenGpuId) {
    next.seenGpuId = gpu.id;
    if (fresh(gpu, now, width, height)) next.gpu = [...next.gpu.filter(sample => fresh(sample, now, width, height)), gpu];
  }
  next.lastFrame = now;
  if (state.lastFrame == null) { next.decisionAt = now; return next; }
  const delta = now - state.lastFrame;
  if (!Number.isFinite(delta) || delta <= 0) return next;
  next.frameMs = state.frameMs == null ? delta : state.frameMs * .8 + delta * .2;
  next.intervals++;
  if (next.intervals >= 12 && now - (next.decisionAt ?? now) >= 200) {
    const values = next.gpu.filter(sample => fresh(sample, now, width, height)).map(sample => sample.ms).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length ? values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2 : null;
    next.scale = nextRenderScale(next.scale, Math.max(next.frameMs,renderLatencyMs??0), median, next.profile, economy);
    next.intervals = 0; next.decisionAt = now; next.gpu = [];
  }
  const overloaded = next.profile !== 'quality' && next.scale <= qualityProfiles[next.profile].min && Math.max(next.frameMs,renderLatencyMs??0) > 23;
  next.overloadedSince = overloaded ? next.overloadedSince ?? now : null;
  if (next.overloadedSince != null && now - next.overloadedSince >= 600) next.glassReduced = true;
  return next;
}
