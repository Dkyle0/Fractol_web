import { sceneMathKey } from './sceneIdentity';
import type { SceneState } from './types';
import type { ViewingArithmetic } from './viewing';
import type { ResourceMode } from './resources';

export const PREVIEW_FIELD_ENCODING = 'rgba8-outcomes-v1';
export interface PreviewFieldDescriptor {
  scene: SceneState; arithmetic: ViewingArithmetic; arithmeticVersion: string; width: number; height: number;
}
export function previewFieldKey(field: PreviewFieldDescriptor) {
  return JSON.stringify([sceneMathKey(field.scene), field.arithmetic, field.arithmeticVersion, PREVIEW_FIELD_ENCODING, field.width, field.height]);
}
export const previewCachePolicies = Object.freeze({
  standard: { maxBytes: 32 * 1024 * 1024, maxEntries: 8 },
  economy: { maxBytes: 4 * 1024 * 1024, maxEntries: 4 },
});
interface Entry<T> { value: T; descriptor: PreviewFieldDescriptor; bytes: number; ready: boolean }
/** Allocation/disposal is injected: this module never accesses WebGL. */
export class PreviewFieldCache<T> {
  private entries = new Map<string, Entry<T>>();
  private mode: ResourceMode = 'standard';
  private disabled = false;
  constructor(private disposeValue: (value: T) => void) {}
  get bytes() { return [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0); }
  get size() { return this.entries.size; }
  get unavailable() { return this.disabled; }
  private compatible(field: PreviewFieldDescriptor) {
    return Number.isInteger(field.width) && Number.isInteger(field.height) && field.width > 0 && field.height > 0 &&
      (this.mode !== 'economy' || (field.arithmetic === 'float32' && field.scene.iterations <= 512 && field.width * field.height <= 600_000));
  }
  setMode(mode: ResourceMode) {
    this.mode = mode;
    for (const [key, entry] of this.entries) if (!this.compatible(entry.descriptor)) this.remove(key);
    const policy = previewCachePolicies[mode];
    while (this.bytes > policy.maxBytes || this.size > policy.maxEntries) this.evict();
  }
  private evict() { const key = this.entries.keys().next().value; if (key !== undefined) this.remove(key); }
  remove(key: string, expected?:T) { const entry = this.entries.get(key); if (entry && (expected===undefined||entry.value===expected)) { this.entries.delete(key); this.disposeValue(entry.value); } }
  has(key: string) { return this.entries.has(key); }
  /** Pending copies count toward both limits before any GPU work is queued. */
  allocate(field: PreviewFieldDescriptor, create: () => T): T | null {
    const key = previewFieldKey(field), bytes = field.width * field.height * 4, policy = previewCachePolicies[this.mode];
    if (this.disabled || !this.compatible(field) || bytes > policy.maxBytes || this.entries.has(key)) return null;
    while (this.bytes + bytes > policy.maxBytes || this.size >= policy.maxEntries) this.evict();
    try {
      const descriptor={...field,scene:structuredClone(field.scene)};
      const value = create();
      this.entries.set(key, { value, bytes, descriptor, ready: false });
      return value;
    } catch { this.disabled = true; return null; }
  }
  markReady(key: string, value: T) { const entry = this.entries.get(key); if (entry?.value === value) entry.ready = true; }
  get(key: string): T | null {
    const entry = this.entries.get(key); if (!entry?.ready) return null;
    this.entries.delete(key); this.entries.set(key, entry); return entry.value;
  }
  clear() { for (const key of [...this.entries.keys()]) this.remove(key); }
  /** A lost context has already released its handles; don't delete them in a new generation. */
  abandon() { this.entries.clear(); this.disabled = false; }
  reset() { this.clear(); this.disabled = false; }
}
