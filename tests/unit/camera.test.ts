import { describe, expect, it } from 'vitest';
import { minimumHeight, panCamera, renderSize, screenToWorld, zoomAt } from '../../src/domain/camera';
import { doubleSingleViewingLimits } from '../../src/domain/viewing';
describe('complex-plane camera', () => {
  const camera = { x: -.65, y: .2, height: 4 }, view = { width: 1600, height: 1000 };
  it('maps the center and preserves equal axis scale', () => {
    expect(screenToWorld(camera, view, 800, 500)).toEqual({ x: -.65, y: .2 });
    expect(screenToWorld(camera, view, 900, 400)).toEqual({ x: -.25, y: .6000000000000001 });
  });
  it.each([[0, 0], [800, 500], [1200, 800], [1599, 999]])('anchors zoom at %s,%s', (x, y) => {
    const before = screenToWorld(camera, view, x, y);
    const after = screenToWorld(zoomAt(camera, view, x, y, .6), view, x, y);
    expect(after.x).toBeCloseTo(before.x, 12); expect(after.y).toBeCloseTo(before.y, 12);
  });
  it('moves the world with the pointer', () => { expect(panCamera(camera, view, 100, 50)).toEqual({ x: -1.05, y: .4, height: 4 }); });
  it('keeps the default binary64 camera floor unless a viewer floor is supplied', () => {
    const next = zoomAt(camera, view, 800, 500, 1e-12);
    expect(next.height).toBeGreaterThanOrEqual(minimumHeight(next, view));
    const viewed = zoomAt(camera, view, 800, 500, 1e-12, doubleSingleViewingLimits, renderSize(view, 1.5).height);
    expect(viewed.height).toBeGreaterThanOrEqual(minimumHeight(viewed, view, doubleSingleViewingLimits));
  });
  it('caps DPR and total pixel count', () => {
    const size = renderSize({ width: 3840, height: 2160 }, 3);
    expect(size.width * size.height).toBeLessThanOrEqual(3_000_000);
    expect(renderSize(view, 1).width).toBe(1600); expect(renderSize(view, 2, .5).width).toBe(1200);
  });
});
