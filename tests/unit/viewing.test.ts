import { describe, expect, it } from 'vitest';
import { createScene } from '../../src/domain/catalog';
import { renderSize, screenToWorld, zoomAt } from '../../src/domain/camera';
import { computeViewingPlan, doubleSingleViewingLimits, floatViewingLimits, viewingScene } from '../../src/domain/viewing';

describe('viewing arithmetic and camera limits', () => {
  const view = { width: 1920, height: 1080 };

  it('uses the agreed DS and float32 safety budgets', () => {
    expect(doubleSingleViewingLimits).toEqual({ bits: 40, minimum: 1e-12, safety: 8, referenceHeight: 1080 });
    expect(floatViewingLimits).toEqual({ bits: 23, minimum: 1e-5, safety: 8, referenceHeight: 1080 });
  });

  it('matches the DS numeric floor at origin and scales it with a displaced camera', () => {
    const dprView = { width: 1920, height: 1080 }, dpr = 1.5;
    const outputHeight = renderSize(dprView, dpr).height;
    const origin = createScene(); origin.camera = { x: 0, y: 0, height: 1e-15 };
    const originState = computeViewingPlan(origin, dprView, dpr);
    const originFloor = 8 * outputHeight * 2 ** -40;
    expect(originFloor).toBeCloseTo(9.45e-9, 10);
    expect(originState.minimumHeight).toBe(originFloor);
    const m2 = createScene(); m2.camera = { x: 2, y: 0, height: 3.8 };
    expect(computeViewingPlan(m2, dprView, dpr).minimumHeight).toBe(originFloor * 2);
  });

  it('keeps the numerical DS floor unchanged during interactive iteration capping', () => {
    const scene = createScene(); scene.camera = { x: -0.65, y: 0.2, height: 1e-15 }; scene.iterations = 3584;
    const settled = computeViewingPlan(scene, view, 1);
    const moving = computeViewingPlan(scene, view, 1, { interactive: true });
    expect(moving.minimumHeight).toBe(settled.minimumHeight);
    expect(moving.camera.height).toBe(settled.camera.height);
    expect(moving.effectiveIterations).toBe(3584);
    expect(settled.effectiveIterations).toBe(3584);
  });

  it('renders a deep requested camera at a safe overview without mutating the scene', () => {
    const scene = createScene(); scene.camera = { x: -.65, y: .2, height: 1e-15 }; scene.iterations = 4096;
    const before = structuredClone(scene), state = computeViewingPlan(scene, view, 1);
    expect(state.requestedCamera).toEqual(before.camera);
    expect(state.camera.height).toBeGreaterThan(before.camera.height);
    expect(state.overview).toBe(true);
    expect(state.arithmetic).toBe('double-single');
    expect(state.effectiveIterations).toBe(4096);
    expect(scene).toEqual(before);
    expect(viewingScene(scene, state).camera).toEqual(state.camera);
  });

  it('preserves requested iterations while moving and after settling', () => {
    const scene = createScene(); scene.iterations = 16384;
    expect(computeViewingPlan(scene, view, 1, { interactive: true }).effectiveIterations).toBe(16384);
    expect(computeViewingPlan(scene, view, 1).effectiveIterations).toBe(16384);
  });

  it.each([64, 512, 2000, 3584, 16384])('keeps selected N=%i through interactive and settled viewing', iterations => {
    const scene = createScene(); scene.iterations = iterations;
    const moving = computeViewingPlan(scene, view, 1, { interactive: true });
    const settled = computeViewingPlan(scene, view, 1);
    expect(moving.effectiveIterations).toBe(iterations);
    expect(settled.effectiveIterations).toBe(iterations);
    expect(moving.arithmetic).toBe(iterations <= 2000 ? 'float32' : 'double-single');
  });

  it('uses float32 through 2000 iterations when coordinates are safe', () => {
    const scene = createScene();
    for (const iterations of [512, 513, 2000]) {
      scene.iterations = iterations;
      expect(computeViewingPlan(scene, view, 1).arithmetic).toBe('float32');
    }
    scene.iterations = 2001;
    expect(computeViewingPlan(scene, view, 1).arithmetic).toBe('double-single');
  });

  it('keeps deep cameras on double-single even at 2000 iterations', () => {
    const scene = createScene(); scene.camera = { x: 3, y: 3, height: 1e-6 }; scene.iterations = 2000;
    expect(computeViewingPlan(scene, view, 1).arithmetic).toBe('double-single');
  });

  it('keeps double-single through the configured float32 hysteresis band', () => {
    const scene = createScene(); scene.camera = { x: -.65, y: .2, height: .002 };
    const state = computeViewingPlan(scene, view, 1, { previousArithmetic: 'double-single' });
    expect(state.arithmetic).toBe('double-single');
    expect(computeViewingPlan(scene, view, 1).arithmetic).toBe('float32');
  });

  it('uses float32 only within its safe range and falls back to a bounded overview when DS is unavailable', () => {
    const scene = createScene();
    expect(computeViewingPlan(scene, view, 1).arithmetic).toBe('float32');
    scene.camera = { x: -.65, y: .2, height: 1e-12 };
    scene.iterations = 3584;
    const limited = computeViewingPlan(scene, view, 1, { unavailable: 'probe failed' });
    expect(limited.arithmetic).toBe('float32'); expect(limited.effectiveIterations).toBe(2000);
    expect(limited.overview).toBe(true); expect(limited.warning).toContain('probe failed');
  });

  it('preserves pointer anchoring and respects the viewing DS floor for numeric zoom', () => {
    const scene = createScene(); scene.camera = { x: -.65, y: .2, height: 1e-4 };
    const finalHeight = renderSize(view, 2).height;
    const camera = zoomAt(scene.camera, view, 1500, 300, 1e-14, doubleSingleViewingLimits, finalHeight);
    const before = screenToWorld(scene.camera, view, 1500, 300), after = screenToWorld(camera, view, 1500, 300);
    expect(camera.height).toBeGreaterThanOrEqual(computeViewingPlan({ ...scene, camera }, view, 2).minimumHeight);
    expect(after.x).toBeCloseTo(before.x, 12); expect(after.y).toBeCloseTo(before.y, 12);
  });
});
