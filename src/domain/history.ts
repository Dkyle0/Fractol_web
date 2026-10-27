import { copyScene, type SceneState } from './types';

export const sameScene = (a: SceneState, b: SceneState) => JSON.stringify(a) === JSON.stringify(b);
/** Stores completed user actions only; intermediate gesture frames stay outside the stack. */
export class SceneHistory {
  private past: SceneState[] = [];
  private future: SceneState[] = [];
  private start: SceneState | null = null;
  constructor(private limit = 100) {}
  get canUndo() { return this.start !== null || this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  begin(scene: SceneState) { if (!this.start) this.start = copyScene(scene); }
  commit(scene: SceneState) {
    if (this.start && !sameScene(this.start, scene)) {
      this.past.push(this.start); this.past = this.past.slice(-this.limit); this.future = [];
    }
    this.start = null;
  }
  undo(scene: SceneState) {
    this.commit(scene);
    const previous = this.past.pop();
    if (!previous) return copyScene(scene);
    this.future.push(copyScene(scene)); return copyScene(previous);
  }
  redo(scene: SceneState) {
    this.commit(scene);
    const next = this.future.pop();
    if (!next) return copyScene(scene);
    this.past.push(copyScene(scene)); return copyScene(next);
  }
}
