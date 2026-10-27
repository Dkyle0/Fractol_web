import { defaultRenderLimits, numericalMinimum, type RenderLimits, type NumericalLimits } from './renderLimits';
import type { Camera } from './types';

export interface Viewport { width: number; height: number }
export function screenToWorld(camera: Camera, view: Viewport, x: number, y: number) {
  const step = camera.height / Math.max(1, view.height);
  return { x: camera.x + (x - view.width / 2) * step, y: camera.y - (y - view.height / 2) * step };
}
export function minimumHeight(camera: Camera, view: Viewport, limits?: NumericalLimits) {
  return numericalMinimum(camera, renderSize(view, 1.5).height, limits);
}
export function floatPreviewSafe(camera: Camera, view: Viewport) {
  return camera.height >= Math.max(1e-5, Math.max(1, Math.abs(camera.x), Math.abs(camera.y)) * 2 ** -23 * Math.max(1, view.height) * 6);
}
export function zoomAt(camera: Camera, view: Viewport, x: number, y: number, factor: number, limits?: NumericalLimits, finalHeight?: number): Camera {
  const floor = (c: Camera) => finalHeight == null ? minimumHeight(c, view, limits) : numericalMinimum(c, finalHeight, limits);
  let height = Math.min(12, Math.max(floor(camera), camera.height * factor));
  let next: Camera = camera;
  // Off-center zoom also changes the magnitude used by the precision guard.
  for (let i=0;i<3;i++) {
    const step = (camera.height-height)/Math.max(1,view.height);
    next={ x: camera.x+(x-view.width/2)*step, y: camera.y-(y-view.height/2)*step, height };
    const minimum=floor(next);
    if (height>=minimum) return next;
    height=minimum*(1+Number.EPSILON*2);
  }
  return next;
}
/** Gesture positions and camera are anchored at gesture start, avoiding drift. */
export function gestureCamera(camera: Camera, view: Viewport, from: { x: number; y: number }, to: { x: number; y: number }, factor = 1, limits?: NumericalLimits, finalHeight?: number) {
  return panCamera(zoomAt(camera, view, from.x, from.y, factor, limits, finalHeight), view, to.x-from.x, to.y-from.y);
}
export function panCamera(camera: Camera, view: Viewport, dx: number, dy: number): Camera {
  const step = camera.height / Math.max(1, view.height);
  return { ...camera, x: camera.x - dx * step, y: camera.y + dy * step };
}
export function renderSize(view: Viewport, dpr: number, scale = 1, limits: RenderLimits = defaultRenderLimits) {
  const ratio = Math.min(Math.max(1, dpr), limits.maxDpr) * scale;
  const cap = Math.min(1, Math.sqrt(limits.maxPixels / Math.max(1, view.width * view.height * ratio * ratio)));
  return { width: Math.max(1, Math.floor(view.width * ratio * cap)), height: Math.max(1, Math.floor(view.height * ratio * cap)) };
}
