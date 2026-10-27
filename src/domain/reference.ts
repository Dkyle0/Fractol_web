import { getFractal } from './catalog';
import type { FractalId, OrbitResult, Parameters } from './types';

export interface EscapeResult { escaped: boolean; value: number; iterations: number }
/** Independent CPU reference. Never used for interactive rendering. */
export function escapePoint(id: FractalId, px: number, py: number, maxIterations: number, parameters: Parameters): EscapeResult {
  let x = 0, y = 0, cx = px, cy = py;
  const legacy = getFractal(id).resultKind === 'legacy-escape';
  if (id === 'julia') { x = px; y = py; cx = parameters.juliaRe; cy = parameters.juliaIm; }
  if (legacy) { x = px; y = py; }
  const limit = id === 'legacy-something' ? 16 : id === 'julia' ? Math.max(4, cx * cx + cy * cy + 2) : 4;
  let n = 0;
  while (n < maxIterations && (id === 'legacy-ship' ? x * x + y * y < limit : x * x + y * y <= limit)) {
    const a = x * x - y * y, b = 2 * x * y;
    switch (id) {
      case 'multibrot': {
        let rx = 1, ry = 0;
        for (let p = 0; p < parameters.power; p++) { const temp = rx * x - ry * y; ry = rx * y + ry * x; rx = temp; }
        x = rx + cx; y = ry + cy; break;
      }
      case 'burning-ship': x = a + cx; y = Math.abs(b) + cy; break;
      case 'tricorn': x = a + cx; y = -b + cy; break;
      case 'celtic': x = Math.abs(a) + cx; y = b + cy; break;
      case 'buffalo': x = Math.abs(a) + cx; y = Math.abs(b) + cy; break;
      case 'perpendicular': { const oldX = x; x = a + cx; y = -2 * Math.abs(oldX) * y + cy; break; }
      case 'legacy-ship': x = Math.abs(a + cx); y = Math.abs(b) + cy; break;
      case 'legacy-something': x = a + cx; y = 2 * x * y + cy; cx = cx / 2 + x; cy = cy / 2 + y; break;
      default: x = a + cx; y = b + cy;
    }
    n++;
  }
  const escaped = n < maxIterations;
  const degree = id === 'multibrot' ? parameters.power : 2;
  const value = escaped && !legacy ? Math.max(0, n + 1 - Math.log(Math.log(Math.max(1.00001, Math.hypot(x, y)))) / Math.log(degree)) : n;
  return { escaped, value, iterations: n };
}

type Complex = [number, number];
const multiply = ([x, y]: Complex, [a, b]: Complex): Complex => [x * a - y * b, x * b + y * a];
function power(z: Complex, n: number): Complex { let result: Complex = [1, 0]; for (let i = 0; i < n; i++) result = multiply(result, z); return result; }
/** Scaled complex division: no squaring of an unscaled denominator. */
function divide(a: Complex, b: Complex): Complex | null {
  const scale = Math.max(Math.abs(b[0]), Math.abs(b[1]));
  if (scale === 0) return null;
  const x = b[0] / scale, y = b[1] / scale, norm = x * x + y * y;
  const re = a[0] / scale, im = a[1] / scale;
  return [(re * x + im * y) / norm, (im * x - re * y) / norm];
}
const magnitude = (z: Complex) => Math.hypot(...z);
const finite = (z: Complex) => z.every(Number.isFinite);
const tolerance = 1e-5;
function crossing(n: number, previous: number, current: number) {
  if (!(previous > tolerance && current > 0 && current < previous) || !Number.isFinite(previous)) return n;
  const fraction = Math.log(previous / tolerance) / Math.log(previous / current);
  return Number.isFinite(fraction) ? n - 1 + Math.max(0, Math.min(1, fraction)) : n;
}
/** Independent double-precision oracle, not shared with the GPU implementation. */
export function evaluatePoint(id: FractalId, px: number, py: number, budget: number, parameters: Parameters): OrbitResult {
  if (!['newton', 'nova', 'phoenix', 'magnet-1'].includes(id)) {
    const old = escapePoint(id, px, py, budget, parameters);
    return { status: old.escaped ? 'escaped' : 'unresolved', root: null, value: old.value };
  }
  let z: Complex = id === 'nova' ? [1, 0] : id === 'magnet-1' ? [0, 0] : [px, py];
  let previousZ: Complex = [0, 0];
  let error = id === 'newton' ? magnitude([power(z, parameters.power)[0] - 1, power(z, parameters.power)[1]]) : id === 'magnet-1' ? 1 : Infinity;
  const result = (status: OrbitResult['status'], value: number): OrbitResult => {
    let root: number | null = null;
    if (id === 'newton' && status === 'converged') {
      let distance = Infinity;
      for (let i = 0; i < parameters.power; i++) {
        const angle = 2 * Math.PI * i / parameters.power;
        const next = Math.hypot(z[0] - Math.cos(angle), z[1] - Math.sin(angle));
        if (next < distance) { root = i; distance = next; }
      }
    }
    return { status, root, value };
  };
  if (!finite(z)) return result('numerical-error', 0);
  if (id === 'newton' && error <= tolerance) return result('converged', 0);
  for (let n = 1; n <= budget; n++) {
    const old = z, oldError = error;
    if (id === 'newton' || id === 'nova') {
      const degree = id === 'newton' ? parameters.power : 3;
      const numerator = power(z, degree), derivative = power(z, degree - 1).map(v => v * degree) as Complex;
      const quotient = divide([numerator[0] - 1, numerator[1]], derivative);
      if (!quotient) return result('singular', n - 1);
      const a = id === 'nova' ? parameters.novaRelaxation ?? 1 : 1;
      z = [z[0] - a * quotient[0] + (id === 'nova' ? px : 0), z[1] - a * quotient[1] + (id === 'nova' ? py : 0)];
      const residual = power(z, degree);
      error = id === 'newton' ? Math.hypot(residual[0] - 1, residual[1]) : Math.hypot(z[0] - old[0], z[1] - old[1]);
    } else if (id === 'phoenix') {
      const squared = multiply(z, z), memory = parameters.phoenixMemory ?? -.5;
      z = [squared[0] + (parameters.phoenixRe ?? .56667) + memory * previousZ[0], squared[1] + (parameters.phoenixIm ?? 0) + memory * previousZ[1]];
      previousZ = old;
    } else {
      const squared = multiply(z, z);
      const quotient = divide([squared[0] + px - 1, squared[1] + py], [2 * z[0] + px - 2, 2 * z[1] + py]);
      if (!quotient) return result('singular', n - 1);
      z = multiply(quotient, quotient); error = Math.hypot(z[0] - 1, z[1]);
    }
    if (!finite(z) || Number.isNaN(error)) return result('numerical-error', n);
    if (id !== 'phoenix' && error <= tolerance) return result('converged', crossing(n, oldError, error));
    if ((id === 'phoenix' && magnitude(z) > 16) || (id === 'magnet-1' && magnitude(z) > 100)) {
      return result('escaped', Math.max(0, n + 1 - Math.log(Math.log(magnitude(z))) / Math.log(2)));
    }
  }
  return result('unresolved', budget);
}

