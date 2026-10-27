import type { Camera } from './types';
export interface RenderLimits { readonly maxDpr: number; readonly maxPixels: number }
export const defaultRenderLimits: RenderLimits = Object.freeze({ maxDpr: 1.5, maxPixels: 3_000_000 });
export interface NumericalLimits { readonly bits: number; readonly minimum: number; readonly safety: number; readonly referenceHeight: number }
export const binary64CameraLimits: NumericalLimits = Object.freeze({ bits: 52, minimum: 1e-15, safety: 6, referenceHeight: 1080 });
export function numericalMinimum(camera: Camera, finalHeight: number, limits: NumericalLimits = binary64CameraLimits) {
  return Math.max(limits.minimum, Math.max(1, Math.abs(camera.x), Math.abs(camera.y)) * 2 ** -limits.bits * Math.max(limits.referenceHeight, finalHeight) * limits.safety);
}
/** Owned RGBA8 fields only; does not estimate driver allocations or total VRAM. */
export const fieldBytes = (width: number, height: number) => width * height * 4;
