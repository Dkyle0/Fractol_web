import type { SceneState } from './types';

/** Mathematical field identity. Coloring and object property order do not affect orbits. */
export function sceneMathKey(scene: SceneState): string {
  return JSON.stringify([
    scene.fractalId, scene.formulaVersion,
    [scene.camera.x, scene.camera.y, scene.camera.height],
    Object.entries(scene.parameters).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)),
    scene.iterations,
  ]);
}

export function sameSceneMath(a: SceneState | null, b: SceneState): boolean {
  return a !== null && sceneMathKey(a) === sceneMathKey(b);
}
