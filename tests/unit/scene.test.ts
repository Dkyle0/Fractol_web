import { describe, expect, it } from 'vitest';
import { createScene, fractals } from '../../src/domain/catalog';
import { applyPreset, decodeScene, encodeScene, parseLibrary, parseScene } from '../../src/domain/scene';
describe('scene boundary', () => {
  it.each(fractals.map(f => f.id))('round-trips %s and has at least two scenes', id => {
    const scene = createScene(id); expect(decodeScene(encodeScene(scene))).toEqual(scene);
    expect(fractals.find(f => f.id === id)!.presets.length).toBeGreaterThanOrEqual(2);
  });
  it.each([NaN, Infinity, -Infinity, -1, 30_000, '512', null])('rejects invalid iterations %s', iterations => { expect(parseScene({ ...createScene(), iterations })).toBeNull(); });
  it('rejects unsupported formulas and versions', () => {
    expect(parseScene({ ...createScene(), fractalId: 'glsl-injection' })).toBeNull();
    expect(parseScene({ ...createScene(), schemaVersion: 2 })).toBeNull();
    expect(parseScene({ ...createScene(), formulaVersion: 2 })).toBeNull();
  });
  it('validates nested camera, color and math parameters', () => {
    const scene = createScene();
    expect(parseScene({ ...scene, camera: { ...scene.camera, height: 0 } })).toBeNull();
    expect(parseScene({ ...scene, parameters: { ...scene.parameters, power: 2.5 } })).toBeNull();
    expect(parseScene({ ...scene, coloring: { ...scene.coloring, interior: 'url(x)' } })).toBeNull();
    expect(parseScene({ ...scene, coloring: { ...scene.coloring, palette: 'unknown' } })).toBeNull();
  });
  it('handles malformed and oversized links', () => { for (const hash of ['', '#scene=%ZZ', '#scene={', '#wrong=1', '#scene=' + 'x'.repeat(20_000)]) expect(decodeScene(hash)).toBeNull(); });
  it('keeps color and iteration choices when visiting a preset', () => {
    const scene = createScene(); scene.iterations = 1024; scene.coloring.palette = 'ocean';
    const next = applyPreset(scene, 1); expect(next.iterations).toBe(1024); expect(next.coloring.palette).toBe('ocean'); expect(next.camera.height).toBe(.045);
  });
  it('recovers valid parts of a damaged collection', () => {
    const result = parseLibrary({ version: 1, favorites: ['julia', 'julia', 'not-found'], scenes: [{ id: '1', name: ' test ', createdAt: '2026-10-18', scene: createScene() }, { id: '2', name: '', scene: {} }] });
    expect(result.favorites).toEqual(['julia']); expect(result.scenes).toHaveLength(1); expect(result.scenes[0].name).toBe('test');
    expect(parseLibrary(null).scenes).toEqual([]);
  });
});
