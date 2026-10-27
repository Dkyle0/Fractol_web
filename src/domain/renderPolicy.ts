import type { SceneState } from './types';
export type Arithmetic = 'float32' | 'double-single' | 'binary64';
export interface ExecutionPolicy { readonly id: 'viewing' | 'benchmark-preview'; readonly automaticRefinement: boolean; readonly exportArithmetic: Arithmetic }
export const viewingPolicy: ExecutionPolicy = Object.freeze({id:'viewing',automaticRefinement:false,exportArithmetic:'binary64'});
export const benchmarkPreviewPolicy: ExecutionPolicy = Object.freeze({id:'benchmark-preview',automaticRefinement:false,exportArithmetic:'binary64'});
/** A bounded amount of camera drift can use an in-flight preview while input
 * coalesces. A different kernel/limit or distant view must replace it now. */
export function canCoalescePreview(active:SceneState,next:SceneState) {
  const ratio=next.camera.height/active.camera.height;
  return active.fractalId===next.fractalId&&active.formulaVersion===next.formulaVersion&&active.parameters.power===next.parameters.power&&active.iterations===next.iterations
    &&ratio>=.5&&ratio<=2&&Math.abs(next.camera.x-active.camera.x)<=active.camera.height*.5&&Math.abs(next.camera.y-active.camera.y)<=active.camera.height*.5;
}
/** Only an explicit pointer series may finish an older Julia constant. */
export function canCoalesceJulia(active: SceneState, next: SceneState) {
  if (active.fractalId !== 'julia' || next.fractalId !== 'julia') return false;
  const withoutConstant = (scene: SceneState) => JSON.stringify([
    scene.formulaVersion, [scene.camera.x,scene.camera.y,scene.camera.height], scene.iterations,
    Object.entries(scene.parameters).filter(([name]) => name !== 'juliaRe' && name !== 'juliaIm').sort(([a],[b]) => a.localeCompare(b)),
  ]);
  return withoutConstant(active) === withoutConstant(next);
}
