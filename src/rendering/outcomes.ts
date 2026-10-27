import type { OrbitResult } from '../domain/types';

/** RGBA8 v1: RGB = floor(scalar*256); old alpha 0/255 stays unchanged.
 * Extended alpha: 0 unresolved, 1 singular, 2 numerical error, 3 converged,
 * 4 escaped, 16..23 converged to the corresponding Newton root (0..7).
 * 254 is reserved for unknown preview coverage/range, never an exact outcome.
 */
export function decodeOutcome(bytes: Uint8Array): OrbitResult {
  const code = bytes[3];
  const status = code === 255 || code === 4 ? 'escaped' : code === 3 || (code >= 16 && code <= 23) ? 'converged' : code === 1 ? 'singular' : code === 2 ? 'numerical-error' : 'unresolved';
  return { status, root: code >= 16 && code <= 23 ? code - 16 : null, value: (bytes[0] * 65536 + bytes[1] * 256 + bytes[2]) / 256 };
}
