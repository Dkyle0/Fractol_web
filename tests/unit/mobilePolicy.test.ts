import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScene } from '../../src/domain/catalog';
import type { SceneState } from '../../src/domain/types';
import { renderSize } from '../../src/domain/camera';
import { computeViewingPlan } from '../../src/domain/viewing';
import { isResourcePreference, nextPresentation, resourcePolicies, resolveResourceMode } from '../../src/domain/resources';
import { PREFERENCES_KEY, readPreferences, writePreferences } from '../../src/infrastructure/preferences';
import { RenderSession } from '../../src/rendering/session';
import type { FieldRequest } from '../../src/rendering/backend';
import { FakeBackend } from './fakeBackend';

describe('resource policies', () => {
  it('uses the device hint only for automatic selection', () => {
    expect(resolveResourceMode('auto', true)).toBe('economy');
    expect(resolveResourceMode('auto', false)).toBe('standard');
    expect(resolveResourceMode('standard', true)).toBe('standard');
    expect(resolveResourceMode('economy', false)).toBe('economy');
    expect(isResourcePreference('auto')).toBe(true);
    expect(isResourcePreference('economy')).toBe(true);
    expect(isResourcePreference('mobile')).toBe(false);
  });

  it('keeps the economy budget explicit and bounded', () => {
    expect(resourcePolicies.economy).toMatchObject({
      mode: 'economy', limits: { maxDpr: 1, maxPixels: 600_000 },
      targetFps: 30, iterationLimit: 512, floatOnly: true,
    });
    expect(resourcePolicies.standard.targetFps).toBe(60);
    const size = renderSize({ width: 1920, height: 1080 }, 2, 1, resourcePolicies.economy.limits);
    expect(size.width * size.height).toBeLessThanOrEqual(600_000);
    expect(size.width).toBeLessThan(1920);
  });

  it.each([60, 90, 120])('limits presentation cadence to about 30fps on a %iHz display clock', displayHz => {
    let due = 0, accepted = 0;
    for (let frame = 0; frame < displayHz * 10; frame++) {
      const now = frame * 1000 / displayHz;
      if (due === 0 || now + 0.05 >= due) { accepted++; due = nextPresentation(now, due, 30); }
    }
    expect(accepted / 10).toBeGreaterThanOrEqual(29);
    expect(accepted / 10).toBeLessThanOrEqual(31);
  });

  it('caps economy viewing at 512 float32 and preserves a deep source camera as an overview', () => {
    const scene = createScene();
    scene.camera = { x: 3, y: 3, height: 1e-10 };
    scene.iterations = 4096;
    const original = structuredClone(scene);
    const state = computeViewingPlan(scene, { width: 900, height: 700 }, 2, { resourceMode: 'economy' });
    expect(state.effectiveIterations).toBe(512);
    expect(state.requestedIterations).toBe(4096);
    expect(state.arithmetic).toBe('float32');
    expect(state.overview).toBe(true);
    expect(state.camera.height).toBeGreaterThan(scene.camera.height);
    expect(scene).toEqual(original);
  });

  it('intersects explicit device limits with economy limits instead of widening either budget', () => {
    const scene = createScene(); scene.iterations = 4096;
    const state = computeViewingPlan(scene, { width: 1920, height: 1080 }, 2, {
      resourceMode: 'economy', renderLimits: { maxDpr: 1.5, maxPixels: 3_000_000 },
    });
    expect(state.effectiveIterations).toBe(512);
    const standardLimited = computeViewingPlan(scene, { width: 1920, height: 1080 }, 2, {
      resourceMode: 'standard', renderLimits: { maxDpr: 1, maxPixels: 600_000 },
    });
    expect(standardLimited.effectiveIterations).toBe(4096);
    expect(standardLimited.arithmetic).toBe('double-single');
  });
});

describe('resource preference persistence', () => {
  const values = new Map<string, string>();
  afterEach(() => vi.unstubAllGlobals());
  function stubStorage() {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  }

  it('reads old preferences without a resource mode and round trips a selected mode', () => {
    stubStorage();
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, lightGlass: false, diagnostics: false, qualityProfile: 'auto' }));
    expect(readPreferences().preferences.resourceMode).toBeUndefined();
    const previous = readPreferences().preferences;
    expect(writePreferences({ ...previous, resourceMode: 'economy' })).toBe(true);
    expect(readPreferences().preferences.resourceMode).toBe('economy');
  });

  it('normalizes an unknown saved mode to automatic selection', () => {
    stubStorage();
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: 1, lightGlass: false, diagnostics: false, qualityProfile: 'auto', resourceMode: 'tablet' }));
    expect(readPreferences().preferences.resourceMode).toBe('auto');
  });
});

describe('economy render session', () => {
  it('caps preview, remains idle after readiness, and exports the ready viewing field', async () => {
    vi.useFakeTimers();
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frameCallbacks.set(++nextFrameId, callback); return nextFrameId; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frameCallbacks.delete(id));

    const source = createScene();
    source.iterations = 4096;
    source.camera = { x: 3, y: 3, height: 1e-10 };
    const backend = new FakeBackend();
    const preview = vi.spyOn(backend, 'preview');
    const refinement = vi.spyOn(backend, 'refineField');
    const captureViewingField = vi.fn(async (_scene: SceneState, _width: number, _height: number, _signal?: AbortSignal) => new Blob());
    (backend as FakeBackend & { captureViewingField: typeof captureViewingField }).captureViewingField = captureViewingField;
    const callbacks = { stats: vi.fn(), loading: vi.fn(), error: vi.fn(), lightGlass: vi.fn() };
    const session = new RenderSession(backend, source, callbacks);
    session.setResourceMode('economy');
    session.resize({ width: 1200, height: 800 });

    async function frame() {
      vi.advanceTimersByTime(1000 / 60);
      const callbacksForFrame = [...frameCallbacks.values()]; frameCallbacks.clear();
      for (const callback of callbacksForFrame) callback(performance.now());
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }
    try {
      for (let i = 0; i < 12 && !session.getViewState().ready; i++) await frame();
      expect(session.getStats()).toMatchObject({ resourceMode: 'economy', targetFps: 30, renderLimits: { maxDpr: 1, maxPixels: 600_000 } });
      expect(session.getStats().viewing).toMatchObject({ effectiveIterations: 512, arithmetic: 'float32', overview: true, ready: true });
      expect(preview).toHaveBeenCalledTimes(1);
      expect(preview.mock.calls[0]![0]).toMatchObject({ arithmetic: 'float32', waitForCompletion: true, scene: { iterations: 512 } });
      for (let i = 0; i < 12; i++) await frame();
      expect(preview).toHaveBeenCalledTimes(1);
      expect(refinement).not.toHaveBeenCalled();
      await session.exportViewing();
      expect(captureViewingField).toHaveBeenCalledTimes(1);
      expect(captureViewingField.mock.calls[0]![0].iterations).toBe(512);
    } finally {
      session.dispose(); vi.unstubAllGlobals(); vi.useRealTimers();
    }
  });

  it('coalesces camera changes behind one pending economy preview and computes only the latest snapshot', async () => {
    vi.useFakeTimers();
    const frameCallbacks = new Map<number, FrameRequestCallback>(); let nextFrameId = 0;
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frameCallbacks.set(++nextFrameId, callback); return nextFrameId; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frameCallbacks.delete(id));
    const backend = new FakeBackend();
    const pending: Array<() => void> = [];
    const previewSizes: Array<{ interactive?: boolean; width: number; height: number }> = [];
    const preview = vi.fn((request: FieldRequest) => {
      previewSizes.push({ interactive: request.interactive, width: backend.stats.width, height: backend.stats.height });
      return new Promise<void>(resolve => pending.push(() => resolve()));
    });
    backend.preview = preview;
    const recolor = vi.spyOn(backend, 'recolor'), refinement = vi.spyOn(backend, 'refineField');
    const session = new RenderSession(backend, createScene(), { stats: () => {}, loading: () => {}, error: () => {}, lightGlass: () => {} });
    session.setResourceMode('economy'); session.resize({ width: 800, height: 600 });
    async function frame() {
      vi.advanceTimersByTime(1000 / 60);
      const batch = [...frameCallbacks.values()]; frameCallbacks.clear();
      for (const callback of batch) callback(performance.now());
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }
    try {
      for (let i = 0; i < 8 && preview.mock.calls.length === 0; i++) await frame();
      expect(preview).toHaveBeenCalledTimes(1);
      expect(preview.mock.calls[0]![0]).toMatchObject({ waitForCompletion: true, arithmetic: 'float32' });
      const latest = createScene(); latest.camera.x += .03;
      for (let step = 0; step < 4; step++) { latest.camera.x += .005; session.update(latest, true); await frame(); }
      expect(preview).toHaveBeenCalledTimes(1);
      expect(pending).toHaveLength(1);

      pending[0]!();
      for (let i = 0; i < 8 && preview.mock.calls.length < 2; i++) await frame();
      expect(preview).toHaveBeenCalledTimes(2);
      expect(preview.mock.calls[1]![0].scene.camera.x).toBe(latest.camera.x);
      pending[1]!();
      for (let i = 0; i < 8 && !session.getViewState().ready; i++) await frame();
      expect(session.getViewState().ready).toBe(true);
      for (let i = 0; i < 12; i++) await frame();
      const settledCalls = preview.mock.calls.length;
      expect(settledCalls).toBe(3);
      expect(preview.mock.calls.slice(1).every(([request]) => request.scene.camera.x === latest.camera.x)).toBe(true);
      expect(previewSizes[1]!.interactive).toBe(true);
      expect(previewSizes[2]!.interactive).toBe(false);
      expect(previewSizes[2]!.width).toBe(previewSizes[0]!.width);
      expect(previewSizes[2]!.height).toBe(previewSizes[0]!.height);
      pending[2]!();
      for (let i = 0; i < 8 && !session.getViewState().ready; i++) await frame();
      expect(session.getViewState().ready).toBe(true);
      for (let i = 0; i < 12; i++) await frame();
      expect(preview).toHaveBeenCalledTimes(settledCalls);
      expect(recolor).not.toHaveBeenCalled(); expect(refinement).not.toHaveBeenCalled();
    } finally { session.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
});
