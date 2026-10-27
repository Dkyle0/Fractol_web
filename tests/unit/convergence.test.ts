import { describe, expect, it } from 'vitest';
import { createScene, fractals } from '../../src/domain/catalog';
import { evaluatePoint, escapePoint } from '../../src/domain/reference';
import { decodeScene, encodeScene, parseScene } from '../../src/domain/scene';
import { previewLibraryImport } from '../../src/domain/library';
import { decodeOutcome } from '../../src/rendering/outcomes';
import { palettes } from '../../src/domain/palettes';
import { SceneHistory } from '../../src/domain/history';

describe('formula v1 convergence contracts', () => {
  it.each([3, 4, 5, 6, 7, 8])('Newton degree %i identifies every known root', power => {
    for (let root = 0; root < power; root++) {
      const angle = 2 * Math.PI * root / power;
      const result = evaluatePoint('newton', Math.cos(angle), Math.sin(angle), 64, { ...createScene('newton').parameters, power });
      expect(result).toEqual({ status: 'converged', root, value: 0 });
    }
  });
  it('separates poles, exhaustion and numerical errors', () => {
    expect(evaluatePoint('newton', 0, 0, 64, createScene('newton').parameters).status).toBe('singular');
    expect(evaluatePoint('magnet-1', 2, 0, 64, createScene('magnet-1').parameters).status).toBe('singular');
    expect(evaluatePoint('newton', .1, .3, 1, createScene('newton').parameters).status).toBe('unresolved');
    expect(evaluatePoint('newton', NaN, 0, 64, createScene('newton').parameters).status).toBe('numerical-error');
    expect(evaluatePoint('magnet-1', 1, 0, 512, createScene('magnet-1').parameters).status).toBe('unresolved');
  });
  it('checks the last allowed update and interpolates convergence, not log-log escape', () => {
    const params = createScene('newton').parameters;
    const complete = evaluatePoint('newton', 1.01, 0, 512, params);
    expect(complete.status).toBe('converged');
    const budget = Math.ceil(complete.value);
    expect(evaluatePoint('newton', 1.01, 0, budget, params)).toEqual(complete);
    expect(evaluatePoint('newton', 1.01, 0, budget - 1, params).status).toBe('unresolved');
    expect(complete.value % 1).not.toBe(0);
    const phoenix = createScene('phoenix').parameters;
    expect(evaluatePoint('phoenix', 5, 0, 1, phoenix).status).toBe('escaped');
    expect(evaluatePoint('magnet-1', 2.01, 0, 1, params).status).toBe('escaped');
  });
  it.each([.1, 1, 2])('Nova c=0 converges with relaxation %s', novaRelaxation => {
    expect(evaluatePoint('nova', 0, 0, 64, { ...createScene('nova').parameters, novaRelaxation })).toEqual({ status: 'converged', root: null, value: 1 });
  });
  it('Nova has no finite escape threshold and recognizes a pole on the next step', () => {
    expect(evaluatePoint('nova', -1, 0, 64, createScene('nova').parameters).status).toBe('singular');
    expect(evaluatePoint('nova', 1000, 0, 1, createScene('nova').parameters).status).toBe('unresolved');
  });
  it('Phoenix memory changes the orbit; zero memory has Julia geometry', () => {
    const parameters = { ...createScene('phoenix').parameters, phoenixRe: -.8, phoenixIm: .156, juliaRe: -.8, juliaIm: .156, phoenixMemory: 0 };
    let differences = 0;
    for (let x = -1.5; x <= 1.5; x += .15) for (let y = -.9; y <= .9; y += .15) {
      const zero = evaluatePoint('phoenix', x, y, 512, parameters);
      expect(zero.status === 'escaped').toBe(escapePoint('julia', x, y, 512, parameters).escaped);
      if (zero.status !== evaluatePoint('phoenix', x, y, 512, { ...parameters, phoenixMemory: -.5 }).status) differences++;
    }
    expect(differences).toBeGreaterThan(0);
  });
  it('Magnet has both converging and escaping orbits', () => {
    const params = createScene('magnet-1').parameters;
    expect(evaluatePoint('magnet-1', 3, 1, 512, params).status).toBe('converged');
    expect(evaluatePoint('magnet-1', 2.01, 0, 512, params).status).toBe('escaped');
  });
});

describe('v1.3 compatible boundaries', () => {
  it('has fourteen distinct definitions, seven six-stop palettes, and valid independent presets', () => {
    expect(new Set(fractals.map(f => f.id)).size).toBe(14);
    expect(new Set(fractals.map(f => f.shaderKind)).size).toBe(14);
    expect(palettes).toHaveLength(7); expect(palettes.every(p => p.colors.length === 6)).toBe(true);
    for (const f of fractals) {
      if (['newton', 'nova', 'phoenix', 'magnet-1'].includes(f.id)) expect(f.presets).toHaveLength(3);
      f.presets.forEach((_, i) => expect(parseScene(createScene(f.id, i))).toEqual(createScene(f.id, i)));
    }
  });
  it.each(fractals.flatMap(f => f.parameters.map(field => [f.id, field] as const)))('%s validates each declared parameter', (id, field) => {
    for (const value of [field.min, field.max]) expect(parseScene({ ...createScene(id), parameters: { ...createScene(id).parameters, [field.key]: value } })).not.toBeNull();
    for (const value of [null, '1', NaN, field.min - 1, field.max + 1, ...(field.type === 'integer' ? [field.min + .5] : [])]) expect(parseScene({ ...createScene(id), parameters: { ...createScene(id).parameters, [field.key]: value } })).toBeNull();
  });
  it('adds defaults only to the relevant formulas and preserves old JSON', () => {
    for (const f of fractals.slice(0, 10)) {
      const scene = createScene(f.id);
      expect(Object.keys(scene.parameters)).toEqual(['juliaRe', 'juliaIm', 'power']);
      expect(JSON.stringify(parseScene(scene))).toBe(JSON.stringify(scene));
    }
    for (const id of ['nova', 'phoenix'] as const) {
      const scene = createScene(id);
      const missing = { ...scene, parameters: createScene().parameters };
      expect(parseScene(missing)).toEqual(scene);
      expect(decodeScene(encodeScene(scene))).toEqual(scene);
    }
  });
  it.each(['mandelbrot', 'nova'] as const)('normalizing %s does not create a phantom history action', id => {
    const scene = createScene(id), history = new SceneHistory();
    history.begin(parseScene(scene)!); history.commit(scene);
    expect(history.canUndo).toBe(false);
  });
  it('normalization keeps imports idempotent with old IDs and dates', () => {
    const scene = createScene('nova'), item = { id: 'original', name: 'Nova', createdAt: '2026-10-18T00:00:00Z', scene };
    const library = { version: 1 as const, favorites: [], scenes: [item] };
    const imported = { ...library, scenes: [{ ...item, scene: { ...scene, parameters: createScene().parameters } }] };
    const preview = previewLibraryImport(JSON.stringify(imported), library);
    expect(preview.duplicates).toBe(1); expect(preview.additions).toHaveLength(0);
    expect(library.scenes[0]).toEqual(item);
  });
  it('decodes old bytes and every extended status independently of the scalar', () => {
    for (const [code, status, root] of [[0, 'unresolved', null], [255, 'escaped', null], [1, 'singular', null], [2, 'numerical-error', null], [3, 'converged', null], [4, 'escaped', null], [16, 'converged', 0], [23, 'converged', 7]] as const) expect(decodeOutcome(new Uint8Array([0, 2, 128, code]))).toEqual({ status, root, value: 2.5 });
  });
});
