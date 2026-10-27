/** Unit roots are computed only when the degree changes, never per pixel. */
const rootCache = new Map<number, Float32Array>();
const preciseCache = new Map<number, readonly number[]>();
export function unitRoots64(degree: number): readonly number[] {
  let roots = preciseCache.get(degree);
  if (!roots) { roots = Object.freeze(Array.from({ length: degree }, (_,i) => [Math.cos(2*Math.PI*i/degree),Math.sin(2*Math.PI*i/degree)]).flat()); preciseCache.set(degree, roots); }
  return roots;
}
export function unitRoots(degree: number): Float32Array {
  let roots = rootCache.get(degree);
  if (!roots) { roots = new Float32Array(Array.from({ length: degree }, (_, i) => [Math.cos(2 * Math.PI * i / degree), Math.sin(2 * Math.PI * i / degree)]).flat()); rootCache.set(degree, roots); }
  return roots;
}
