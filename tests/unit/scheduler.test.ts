import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScene } from '../../src/domain/catalog';
import { RenderScheduler } from '../../src/rendering/scheduler';

import { FakeBackend } from './fakeBackend';
const control={ gpuMs:1,prepare:null as null|(()=>Promise<void>) };
let backend: FakeBackend;

describe('on-demand scheduler lifecycle and cadence', () => {
  let frames: Map<number, FrameRequestCallback>, nextId: number, scheduler: RenderScheduler;
  const callbacks = { stats: vi.fn(), loading: vi.fn(), error: vi.fn(), lightGlass: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('window', { devicePixelRatio: 1 });
    frames = new Map(); nextId = 0; control.gpuMs = 1; control.prepare = null;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    for (const callback of Object.values(callbacks)) callback.mockClear();
    backend=new FakeBackend(control);
    scheduler = new RenderScheduler(backend, createScene(), callbacks);
    scheduler.resize({ width: 800, height: 600 });
  });
  afterEach(() => { scheduler.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  async function tick(ms = 1000 / 60) {
    vi.advanceTimersByTime(ms);
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(performance.now());
    for (let i = 0; i < 6; i++) await Promise.resolve();
  }
  it.each([1, 2, 4])('does not treat input every %s display frames as overload', async inputEvery => {
    await tick(); await tick();
    const scene = createScene();
    for (let frame = 0; frame < 180; frame++) {
      if (frame % inputEvery === 0) { scene.camera.x += .001; scheduler.update(scene, true); }
      await tick();
    }
    const stats = scheduler.getStats();
    expect(stats.scale).toBe(1); expect(stats.frameMs).toBeLessThan(18);
    expect(callbacks.lightGlass).not.toHaveBeenCalled();
    expect(stats.draws).toBeLessThanOrEqual(Math.ceil(180 / inputEvery) + 12);
    for (let i = 0; i < 15; i++) await tick();
    const settled = scheduler.getStats().draws;
    expect(frames.size).toBe(0);
    await tick(500);
    expect(scheduler.getStats().draws).toBe(settled);
  });
  it('reduces resolution and glass under sustained display/GPU overload', async () => {
    control.gpuMs = 30;
    await tick(); await tick();
    for (let i = 0; i < 150; i++) { scheduler.update(createScene(), true); await tick(1000 / 30); }
    expect(scheduler.getStats().scale).toBe(.35);
    expect(callbacks.lightGlass).toHaveBeenCalledTimes(1);
  });
  for (const rafHz of [60, 120]) for (const inputHz of [30, 60]) it(`keeps ${inputHz}Hz input independent from ${rafHz}Hz rAF and recovers after load`, async () => {
    await tick(); await tick();
    const scene = createScene(), every = rafHz / inputHz;
    for (let i = 0; i < rafHz * 3; i++) {
      if (i % every === 0) { scene.camera.x += .001; scheduler.update(scene, true); }
      await tick(1000 / rafHz);
    }
    expect(scheduler.getStats().scale).toBe(1); expect(callbacks.lightGlass).not.toHaveBeenCalled();
    control.gpuMs = 30;
    for (let i = 0; i < 120; i++) { scheduler.update(scene, true); await tick(1000 / 30); }
    expect(scheduler.getStats().scale).toBe(.35);
    control.gpuMs = 1;
    for (let i = 0; i < rafHz * 4; i++) { scheduler.update(scene, true); await tick(1000 / rafHz); }
    expect(scheduler.getStats().scale).toBe(1);
    for (let i = 0; i < 30; i++) await tick(1000 / rafHz);
    expect(frames.size).toBe(0); expect(scheduler.getStats().scale).toBe(1);
  });
  it('caps performance while moving, preserves quality profile and releases subscribers', async () => {
    await tick(); await tick(); scheduler.setQualityProfile('performance');
    const onFrame = vi.fn(), off = scheduler.subscribe(onFrame);
    for (let i = 0; i < 180; i++) { scheduler.update(createScene(), true); await tick(); }
    expect(scheduler.getStats().scale).toBe(.75); expect(scheduler.getStats().width).toBe(600);
    off(); onFrame.mockClear(); scheduler.setQualityProfile('quality'); control.gpuMs = 30;
    for (let i = 0; i < 100; i++) { scheduler.update(createScene(), true); await tick(34); }
    expect(scheduler.getStats().scale).toBe(1); expect(scheduler.getStats().width).toBe(800);
    expect(callbacks.lightGlass).not.toHaveBeenCalled(); expect(onFrame).not.toHaveBeenCalled();
    scheduler.contextLost(); scheduler.contextRestored(); await tick(); await tick();
    expect(scheduler.getQualityProfile()).toBe('quality');
  });
  it('ignores a failed preparation from the previous context revision', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, fail) => { reject = fail; });
    control.prepare = () => pending;
    await tick();
    scheduler.contextLost(); scheduler.contextRestored();
    control.prepare = null;
    reject(new Error('old compilation failed'));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await tick(); await tick();
    expect(callbacks.error).not.toHaveBeenCalled();
    expect(scheduler.getStats().fractalId).toBe('mandelbrot');
  });
  it('does not report a native context loss as a precision error before its DOM event arrives', async () => {
    Object.assign(backend, {
      isContextLost: () => true,
      isPrecise: () => false, hasField: () => true,
      refineField: () => Promise.reject(new Error('native context lost')),
      cancelRefinement: () => {},
    });
    await tick();await tick();
    expect(callbacks.error).not.toHaveBeenCalled();
    scheduler.contextLost();expect(callbacks.error).not.toHaveBeenCalled();
  });
  it('continues to the latest scene after an obsolete preparation fails', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, fail) => { reject = fail; });
    control.prepare = () => pending;
    await tick();
    scheduler.update(createScene('julia')); control.prepare = null;
    reject(new Error('obsolete formula failed'));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await tick(); await tick();
    expect(callbacks.error).not.toHaveBeenCalled();
    expect(scheduler.getStats().fractalId).toBe('julia');
  });
});
