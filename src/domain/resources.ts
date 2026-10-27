import { defaultRenderLimits, type RenderLimits } from './renderLimits';
export type ResourceMode = 'standard' | 'economy';
export type ResourcePreference = 'auto' | ResourceMode;
export const isResourcePreference = (value: unknown): value is ResourcePreference => value === 'auto' || value === 'standard' || value === 'economy';
export const resourcePolicies = Object.freeze({
  standard: { mode: 'standard', limits: defaultRenderLimits, targetFps: 60, iterationLimit: 16384, floatOnly: false, lightGlass: false },
  economy: { mode: 'economy', limits: Object.freeze({ maxDpr: 1, maxPixels: 600_000 }), targetFps: 30, iterationLimit: 512, floatOnly: true, lightGlass: true },
} satisfies Record<ResourceMode, {mode:ResourceMode;limits:RenderLimits;targetFps:number;iterationLimit:number;floatOnly:boolean;lightGlass:boolean}>);
/** Product limit for editing; separate from the float32 arithmetic threshold. */
export const standardEditorIterationLimit = 2000;
export function iterationEditorLimit(mode: ResourceMode): number {
  return Math.min(standardEditorIterationLimit, resourcePolicies[mode].iterationLimit);
}
export function limitResourceIterations(iterations: number, mode: ResourceMode): number {
  return Math.min(iterations, resourcePolicies[mode].iterationLimit);
}
export function resolveResourceMode(preference: ResourcePreference, mobileHint: boolean): ResourceMode {
  return preference === 'auto' ? mobileHint ? 'economy' : 'standard' : preference;
}
/** No catch-up burst: each accepted presentation reserves the next grid slot. */
export function nextPresentation(now: number, due: number, fps: number) {
  const period = 1000 / fps;
  return due === 0 || now - due >= period ? now + period : due + period;
}
