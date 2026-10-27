import type { GpuMeasurement } from './quality';
export interface PrecisionTile { x: number; y: number; width: number; height: number }
export function precisionSampleMatches(sample:GpuMeasurement|null,usedId:number,started:number,width:number,height:number) {
  // Unlike navigation, this job's scene and framebuffer remain immutable. A
  // late query still measures this job; submission age also includes queue wait.
  return !!sample && sample.kind==='precision' && sample.id>usedId && sample.submittedAt>=started && sample.width===width && sample.height===height;
}
export function fenceTileEstimate(completion: { latencyMs: number; polls: number }, baselineMs: number) {
  // A single wake-up only gives an upper bound. Its scheduling jitter must not
  // freeze tiny tiles when the calibration fence happened to be ready instantly.
  return { costMs: Math.max(0,completion.latencyMs-baselineMs), belowResolution: completion.polls<=1 || completion.latencyMs<=baselineMs };
}
export function nextTileSide(side: number, costMs: number, pixels: number, oneFencePoll = false) {
  // A coarse browser timer cannot resolve GPU cost below its first wake-up.
  // Gradually probe larger tiles instead of interpreting that floor as overload.
  if(oneFencePoll)return Math.min(128,Math.ceil(side*1.25/4)*4);
  if(costMs>8)return Math.max(4,Math.min(side,Math.floor(Math.sqrt(Math.max(1,pixels)*6/costMs)/4)*4));
  // Fit growth inside the 8 ms budget with 0.5 ms of headroom. Projection can
  // permit growth, but cannot establish overload from a cheap boundary sliver.
  const growth=Math.min(128,Math.ceil(side*1.25/4)*4);
  const fitting=Math.floor(Math.sqrt(Math.max(1,pixels)*7.5/Math.max(.000001,costMs))/4)*4;
  return Math.max(side,Math.min(growth,fitting));
}
/** Rectangle partitioning permits shrinking BOTH axes immediately, even mid-row. */
export class PrecisionTiles {
  private regions: PrecisionTile[];
  private side=16;
  private completed=0;
  private stable=0;
  private probeCooldown=0;
  constructor(private width:number,private height:number) { this.regions=[{x:0,y:0,width,height}]; }
  next(): PrecisionTile | null {
    const region=this.regions.pop();if(!region)return null;
    const width=Math.min(this.side,region.width),height=Math.min(this.side,region.height),tile={x:region.x,y:region.y,width,height};
    if(region.height>height)this.regions.push({x:region.x,y:region.y+height,width:region.width,height:region.height-height});
    if(region.width>width)this.regions.push({x:region.x+width,y:region.y,width:region.width-width,height});
    return tile;
  }
  complete(tile:PrecisionTile,costMs:number|null,oneFencePoll = false,samplePixels=tile.width*tile.height) {
    const pixels=tile.width*tile.height;this.completed+=pixels;
    if(costMs!==null){
      let next=nextTileSide(this.side,costMs,samplePixels,oneFencePoll);
      if(costMs>8 && !oneFencePoll){this.probeCooldown=32;this.stable=0;}
      else {
        if(this.probeCooldown>0)this.probeCooldown--;
        this.stable=next===this.side && samplePixels>=this.side*this.side && !oneFencePoll ? this.stable+1 : 0;
        // GPU wave/setup cost need not scale with area. An occasional one-step
        // probe escapes that floor; a costly probe is followed by a cooldown.
        if(this.stable>=8 && this.probeCooldown===0){next=Math.min(128,this.side+4);this.stable=0;}
      }
      this.side=next;
    }
    return this.completed/(this.width*this.height);
  }
}
