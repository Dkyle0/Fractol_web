import { describe,expect,it } from 'vitest';
import { fenceTileEstimate,nextTileSide,precisionSampleMatches,PrecisionTiles } from '../../src/domain/precisionTiles';
describe('adaptive precision tiles',()=>{
  it.each([[1,1],[17,1],[97,53],[320,180]])('covers %s by %s once without overlap through load changes',(width,height)=>{
    const tiles=new PrecisionTiles(width,height),pixels=new Uint8Array(width*height);let count=0,progress=0;
    for(let tile=tiles.next();tile;tile=tiles.next()){
      expect(tile.width).toBeLessThanOrEqual(128);expect(tile.height).toBeLessThanOrEqual(128);
      for(let y=tile.y;y<tile.y+tile.height;y++)for(let x=tile.x;x<tile.x+tile.width;x++)pixels[y*width+x]++;
      const next=tiles.complete(tile,count++%7===0?25:1);expect(next).toBeGreaterThan(progress);progress=next;
    }
    expect(progress).toBe(1);expect(pixels.every(pixel=>pixel===1)).toBe(true);expect(tiles.next()).toBeNull();
  });
  it('shrinks both axes and respects limits under missing GPU timing fallback',()=>{
    expect(nextTileSide(128,20,128*128)).toBeLessThan(128);
    expect(nextTileSide(4,100,16)).toBe(4);expect(nextTileSide(128,1,128*128)).toBe(128);
    // A cheap thin boundary fragment neither proves a larger square cheap nor
    // warrants shrinking a previously selected square by projecting fixed cost.
    expect(nextTileSide(128,1,128)).toBe(128);
    expect(nextTileSide(16,16,256,true)).toBeGreaterThan(16);
  });
  it.each([4.1,6,8,12])('single-wakeup jitter of %s ms does not freeze a cheap field at tiny tiles',latencyMs=>{
    const tiles=new PrecisionTiles(640,480);let count=0,progress=0;
    for(let tile=tiles.next();tile;tile=tiles.next()){
      const estimate=fenceTileEstimate({latencyMs,polls:1},0);
      progress=tiles.complete(tile,estimate.costMs,estimate.belowResolution);count++;
    }
    expect(progress).toBe(1);expect(count).toBeLessThan(150);
    const overloaded=fenceTileEstimate({latencyMs:32,polls:4},0);
    expect(nextTileSide(64,overloaded.costMs,64*64,overloaded.belowResolution)).toBeLessThan(64);
  });
  it('uses the original area of delayed GPU samples without collapsing boundary strips',()=>{
    const tiles=new PrecisionTiles(640,480);let previousPixels=256,count=0,progress=0;
    for(let tile=tiles.next();tile;tile=tiles.next()){
      progress=tiles.complete(tile,3.8,false,previousPixels);
      previousPixels=tile.width*tile.height;count++;
    }
    expect(progress).toBe(1);expect(count).toBeLessThan(300);
    expect(nextTileSide(32,40,4096)).toBeLessThan(32);
  });
  it('keeps the requested size while an asynchronous GPU query is pending',()=>{
    const tiles=new PrecisionTiles(128,128),first=tiles.next()!;
    tiles.complete(first,null);const next=tiles.next()!;
    expect(next.width).toBe(first.width);expect(next.height).toBe(first.height);
  });
  it('recovers through cheap slivers but does not infer overload from fixed overhead',()=>{
    expect(nextTileSide(16,.01,16)).toBeGreaterThan(16);
    expect(nextTileSide(16,3.8,16)).toBe(16);
    expect(nextTileSide(16,50,16)).toBeLessThan(16);
  });
  it('accepts delayed measurements only from the current immutable job',()=>{
    const sample={id:4,kind:'precision' as const,submittedAt:10,width:128,height:128,pixels:256,ms:5};
    expect(precisionSampleMatches(sample,3,0,128,128)).toBe(true);
    expect(precisionSampleMatches(sample,4,0,128,128)).toBe(false);
    expect(precisionSampleMatches(sample,3,11,128,128)).toBe(false);
    expect(precisionSampleMatches(sample,3,0,64,128)).toBe(false);
    expect(precisionSampleMatches({...sample,kind:'preview'},3,0,128,128)).toBe(false);
  });
  it('escapes a fixed per-task floor rather than treating it as per-pixel work',()=>{
    const tiles=new PrecisionTiles(640,480);let count=0,maxPixels=0;
    for(let tile=tiles.next();tile;tile=tiles.next()){
      maxPixels=Math.max(maxPixels,tile.width*tile.height);
      tiles.complete(tile,6);count++;
    }
    expect(maxPixels).toBeGreaterThan(1024);expect(count).toBeLessThan(600);
  });
  it('backs off costly probes and keeps their frequency below five percent on linear work',()=>{
    const tiles=new PrecisionTiles(1024,1024);let count=0,overBudget=0;
    for(let tile=tiles.next();tile;tile=tiles.next()){
      const cost=tile.width*tile.height/40;if(cost>8)overBudget++;
      tiles.complete(tile,cost);count++;
    }
    expect(overBudget).toBeGreaterThan(0);expect(overBudget/count).toBeLessThan(.05);
  });

});
