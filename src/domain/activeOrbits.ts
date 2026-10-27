/** Pure admission policy. Counters describe completed iteration boundaries. */
export function shouldCompactOrbits(iterations:number,limit:number,active:number,pixels:number,previous:number|null) {
  return iterations>=64&&limit-iterations>=64&&active>=256&&active<=pixels*.25&&
    (previous===null||active<=previous*.25);
}
export const ACTIVE_ORBIT_MEMORY_LIMIT=8*1024*1024;
/** Active count cannot increase: once admission is impossible, further scans
 * in this tile cannot help. Diagnostic profiling intentionally ignores this. */
export function canProbeActiveOrbits(remaining:number,lastActive:number,previous:number|null){
  return remaining>=64&&lastActive>=256&&(previous===null||previous>=1024);
}
export interface OrbitActivitySample {
  x:number;y:number;iterations:number;remaining:number;active:number;pixels:number;compacted:boolean;
}
