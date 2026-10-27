import { renderSize, type Viewport } from './camera';
import { numericalMinimum, type NumericalLimits, defaultRenderLimits, type RenderLimits } from './renderLimits';
import { copyScene, type Camera, type SceneState } from './types';
import { limitResourceIterations, resourcePolicies, type ResourceMode } from './resources';

export type ViewingArithmetic = 'float32' | 'double-single';
/** Viewing performance budget, not a bound on orbit error. */
export const float32IterationLimit = 2000;
export const doubleSingleViewingLimits: NumericalLimits = Object.freeze({ bits: 40, minimum: 1e-12, safety: 8, referenceHeight: 1080 });
export const floatViewingLimits: NumericalLimits = Object.freeze({ bits: 23, minimum: 1e-5, safety: 8, referenceHeight: 1080 });
export interface ViewingState {
  requestedCamera: Camera; camera: Camera; overview: boolean; arithmetic: ViewingArithmetic;
  effectiveIterations: number; requestedIterations: number; ready: boolean; minimumHeight: number;
  numericalLimits: NumericalLimits; warning: string;
  updatingJulia?: boolean;
}
export interface ViewingOptions {
  interactive?: boolean; previousArithmetic?: ViewingArithmetic; unavailable?: string;
  renderLimits?: RenderLimits;
  resourceMode?: ResourceMode;
}
/** Coordinate separation only, never a bound on chaotic orbit error. */
export function computeViewingPlan(scene: SceneState, view: Viewport, dpr: number, options: ViewingOptions = {}): ViewingState {
  const policy = resourcePolicies[options.resourceMode ?? 'standard'];
  const device = options.renderLimits ?? defaultRenderLimits;
  const final = renderSize(view, dpr, 1, {maxDpr:Math.min(device.maxDpr,policy.limits.maxDpr),maxPixels:Math.min(device.maxPixels,policy.limits.maxPixels)});
  const limits = options.unavailable || policy.floatOnly ? floatViewingLimits : doubleSingleViewingLimits;
  const minimumHeight = numericalMinimum(scene.camera, final.height, limits);
  const camera = { ...scene.camera, height: Math.max(scene.camera.height, minimumHeight) };
  const effectiveIterations = limitResourceIterations(options.unavailable ? Math.min(scene.iterations, float32IterationLimit) : scene.iterations, policy.mode);
  const floatMinimum = numericalMinimum(camera, final.height, floatViewingLimits);
  const floatSafe = camera.height >= floatMinimum * (options.previousArithmetic === 'double-single' ? 2 : 1);
  const arithmetic: ViewingArithmetic = !policy.floatOnly && !options.unavailable && (!floatSafe || effectiveIterations > float32IterationLimit) ? 'double-single' : 'float32';
  return { requestedCamera: { ...scene.camera }, camera, overview: camera.height > scene.camera.height,
    arithmetic, effectiveIterations, requestedIterations: scene.iterations, ready: false, minimumHeight, numericalLimits: limits,
    warning: options.unavailable ? 'Расширенный просмотр недоступен. Просмотр ограничен float32 и 2000 итерациями; полный предел доступен в точном PNG. ' + options.unavailable : '' };
}
export function viewingScene(source: SceneState, state: ViewingState): SceneState {
  const scene = copyScene(source); scene.camera = { ...state.camera }; scene.iterations = state.effectiveIterations; return scene;
}
