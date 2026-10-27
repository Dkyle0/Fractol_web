import { describe, expect, it, vi } from 'vitest';
import { createScene } from '../../src/domain/catalog';
import { PreviewFieldCache, previewCachePolicies, previewFieldKey, type PreviewFieldDescriptor } from '../../src/domain/previewCache';

function field(index: number, width = 10, height = 10, arithmetic: PreviewFieldDescriptor['arithmetic'] = 'float32'): PreviewFieldDescriptor {
  const scene = createScene(); scene.camera.x += index * .01;
  return { scene, arithmetic, arithmeticVersion: 'test-v1', width, height };
}

describe('GPU preview field cache', () => {
  it('keeps entries pending until ready and evicts the least recently used entry', () => {
    const disposed: string[] = [], cache = new PreviewFieldCache<string>(value => disposed.push(value));
    const a = field(1), b = field(2), c = field(3);
    const va = cache.allocate(a, () => 'a')!, vb = cache.allocate(b, () => 'b')!;
    const ka = previewFieldKey(a), kb = previewFieldKey(b), kc = previewFieldKey(c);
    expect(cache.get(ka)).toBeNull();
    cache.markReady(ka, 'stale value');
    expect(cache.get(ka)).toBeNull();
    cache.markReady(ka, va); cache.markReady(kb, vb);
    expect(cache.get(ka)).toBe('a'); // a is now most recently used
    cache.allocate(c, () => 'c');
    for (let i = 4; i <= 9; i++) cache.allocate(field(i), () => String(i));
    expect(cache.size).toBe(8);
    expect(cache.has(ka)).toBe(true); expect(cache.has(kb)).toBe(false); expect(cache.has(kc)).toBe(true);
    expect(disposed).toEqual(['b']);
  });

  it('enforces standard eight-entry and 32 MiB limits, counting pending allocations', () => {
    const cache = new PreviewFieldCache<number>(() => {});
    const allocate = (i: number, width = 2048, height = 1024) => cache.allocate(field(i, width, height), () => i);
    expect(allocate(0)).toBe(0); // each pending image reserves 8 MiB
    expect(allocate(1)).toBe(1); expect(allocate(2)).toBe(2); expect(allocate(3)).toBe(3);
    expect(cache.bytes).toBe(previewCachePolicies.standard.maxBytes);
    expect(allocate(4)).toBe(4);
    expect(cache.size).toBe(4); expect(cache.bytes).toBe(32 * 1024 * 1024);
    expect(cache.has(previewFieldKey(field(0, 2048, 1024)))).toBe(false); // oldest pending field was evicted
    for (let i = 5; i < 12; i++) allocate(i, 1, 1);
    expect(cache.size).toBeLessThanOrEqual(8);
    expect(cache.bytes).toBeLessThanOrEqual(previewCachePolicies.standard.maxBytes);
  });

  it('enforces economy four-entry and 4 MiB limits and drops incompatible fields', () => {
    const disposed: number[] = [], cache = new PreviewFieldCache<number>(value => disposed.push(value));
    cache.setMode('economy');
    const allocate = (i: number, width = 1024, height = 1024) => cache.allocate(field(i, width, height), () => i);
    expect(allocate(0)).toBeNull(); // a single 4 MiB buffer is over the pixel compatibility cap
    for (let i = 0; i < 6; i++) expect(cache.allocate(field(i, 500, 500), () => i)).toBe(i);
    expect(cache.size).toBe(4); expect(cache.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(disposed).toHaveLength(2);
    const incompatible = field(20, 100, 100, 'double-single');
    expect(cache.allocate(incompatible, () => 20)).toBeNull();
    const tooManyIterations = field(21); tooManyIterations.scene.iterations = 513;
    expect(cache.allocate(tooManyIterations, () => 21)).toBeNull();
    const tooManyPixels = field(22, 800, 800);
    expect(cache.allocate(tooManyPixels, () => 22)).toBeNull();
    cache.setMode('standard');
    expect(cache.allocate(incompatible, () => 20)).toBe(20);
  });

  it('uses an isolated mathematical descriptor and revalidates it when resource mode changes', () => {
    const cache = new PreviewFieldCache<number>(() => {}), original = field(1);
    const key = previewFieldKey(original), value = cache.allocate(original, () => 1)!;
    cache.markReady(key, value);
    original.scene.iterations = 900;
    original.scene.camera.x = 99;
    cache.setMode('economy');
    expect(cache.get(key)).toBe(value);
    const changedMath = field(1); changedMath.scene.camera.x = 99;
    expect(previewFieldKey(changedMath)).not.toBe(key);
    const recolored = field(1); recolored.scene.coloring.palette = 'ember';
    expect(previewFieldKey(recolored)).toBe(key);
  });

  it('rejects invalid and oversized allocations without disabling future allocations', () => {
    const cache = new PreviewFieldCache<number>(() => {}), create = vi.fn(() => 1);
    expect(cache.allocate(field(1, 0, 1), create)).toBeNull();
    expect(cache.allocate(field(2, 1.5, 1), create)).toBeNull();
    expect(cache.allocate(field(3, Number.NaN, 1), create)).toBeNull();
    expect(cache.allocate(field(4, 100_000, 100_000), create)).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(cache.size).toBe(0); expect(cache.bytes).toBe(0);
    expect(cache.allocate(field(5), create)).toBe(1);
  });

  it('does not remove a replacement entry when an older copy fence fails late', () => {
    const disposed: string[] = [], cache = new PreviewFieldCache<string>(value => disposed.push(value));
    const descriptor = field(7), key = previewFieldKey(descriptor);
    const oldCopy = cache.allocate(descriptor, () => 'old')!;
    cache.remove(key, oldCopy);
    const replacement = cache.allocate(descriptor, () => 'replacement')!;
    cache.markReady(key, replacement);
    cache.remove(key, oldCopy);
    expect(cache.has(key)).toBe(true);
    expect(cache.get(key)).toBe(replacement);
    expect(disposed).toEqual(['old']);
  });

  it('disables allocation after a factory failure until reset, and distinguishes clear from abandon', () => {
    const disposed: number[] = [], cache = new PreviewFieldCache<number>(value => disposed.push(value));
    expect(cache.allocate(field(1), () => { throw new Error('allocation failed'); })).toBeNull();
    expect(cache.unavailable).toBe(true);
    expect(cache.allocate(field(2), () => 2)).toBeNull();
    cache.reset(); expect(cache.unavailable).toBe(false);
    const value = cache.allocate(field(3), () => 3)!; expect(value).toBe(3);
    cache.clear(); expect(disposed).toEqual([3]); expect(cache.size).toBe(0);
    cache.allocate(field(4), () => 4);
    cache.abandon(); expect(disposed).toEqual([3]); expect(cache.size).toBe(0); expect(cache.unavailable).toBe(false);
  });
});
