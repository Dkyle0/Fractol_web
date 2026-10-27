import { describe, expect, it } from 'vitest';
import { escapePoint } from '../../src/domain/reference';
import { defaultParameters, fractals } from '../../src/domain/catalog';
describe('CPU reference landmarks', () => {
  it.each(fractals.filter(f => f.id !== 'julia' && f.shaderKind <= 9).map(f => f.id))('%s contains the origin', id => { expect(escapePoint(id, 0, 0, 512, defaultParameters).escaped).toBe(false); });
  it.each(fractals.filter(f => f.shaderKind <= 9).map(f => f.id))('%s escapes far from the origin', id => { expect(escapePoint(id, 3, 3, 512, defaultParameters).escaped).toBe(true); });
  it('Mandelbrot keeps the main bulb and period-two bulb', () => { for (const x of [0, -.5, -1]) expect(escapePoint('mandelbrot', x, 0, 512, defaultParameters).escaped).toBe(false); });
  it('uses a strict bailout for the known orbit 0 → 1 → 2 → 5', () => { const result = escapePoint('mandelbrot', 1, 0, 512, defaultParameters); expect(result.iterations).toBe(3); expect(result.escaped).toBe(true); });
  it.each(['mandelbrot', 'burning-ship', 'tricorn', 'celtic', 'buffalo', 'perpendicular'] as const)('%s preserves the bounded orbit through radius two', id => {
    expect(escapePoint(id, -2, 0, 512, defaultParameters).escaped).toBe(false);
  });
  it('Multibrot degree two includes c=-2', () => { expect(escapePoint('multibrot', -2, 0, 512, { ...defaultParameters, power: 2 }).escaped).toBe(false); });
  it('preserves the original legacy-ship bailout at radius two', () => {
    const result = escapePoint('legacy-ship', -2, 0, 512, defaultParameters);
    expect(result.escaped).toBe(true); expect(result.iterations).toBe(0);
  });
  it('Julia with c=0 has the unit disk', () => {
    const params = { ...defaultParameters, juliaRe: 0, juliaIm: 0 };
    expect(escapePoint('julia', .5, .5, 512, params).escaped).toBe(false);
    expect(escapePoint('julia', 1.1, .1, 512, params).escaped).toBe(true);
  });
  it('legacy Something updates y using the new x', () => {
    // (-1,1): x'=-1, y'=-1, c'=(-1.5,-.5); then x'=-1.5,y'=2.5; then escape on the next iteration.
    expect(escapePoint('legacy-something', -1, 1, 512, defaultParameters).iterations).toBe(3);
  });
  it('legacy ship differs from the canonical formula', () => {
    let differences = 0;
    for (const [x, y] of [[-.8, -.4], [-1.2, -.2], [-1.7, -.05], [.2, .2]]) if (escapePoint('legacy-ship', x, y, 512, defaultParameters).iterations !== escapePoint('burning-ship', x, y, 512, defaultParameters).iterations) differences++;
    expect(differences).toBeGreaterThan(0);
  });
});
