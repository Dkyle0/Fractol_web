import {test,expect} from '@playwright/test';

test('production policy selects only Nova/Newton, reuses exact PNG and survives restoration',async({page})=>{
 test.setTimeout(180000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',ep='/src/domain/reference.ts';
  const {FractalRenderer}=await import(rp),{fractals,createScene}=await import(cp),{evaluatePoint}=await import(ep);
  const canvas=document.createElement('canvas'),renderer=new FractalRenderer(canvas),rows=[];
  try{
   renderer.resize(1,1);
   for(const definition of fractals){
    const scene=createScene(definition.id);scene.iterations=64;scene.camera={x:3,y:3,height:.1};await renderer.refine(scene);
    const point=renderer.readPoint(0,0),cpu=evaluatePoint(definition.id,3,3,64,scene.parameters),stats=renderer.getSnapshot();
    scene.coloring.phase=.4;renderer.draw(scene,true);
    rows.push({id:definition.id,point,cpu,stats,colorComputations:renderer.getSnapshot().computations});
   }
   const scene=createScene('nova');scene.iterations=64;scene.camera={x:3,y:3,height:.1};renderer.resize(9,7);await renderer.refine(scene);
   const before=renderer.getSnapshot(),screenPoint=renderer.readPoint(4,3),png=await renderer.export(scene,9,7),after=renderer.getSnapshot(),afterPoint=renderer.readPoint(4,3);
   // The first PNG owns an isolated exact field; the second reuses its cache.
   const repeated=await renderer.export(scene,9,7),afterRepeat=renderer.getSnapshot();
   const extension=renderer.getContext().getExtension('WEBGL_lose_context');let restored=null;
   if(extension){
    const lost=new Promise<void>(resolve=>canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();renderer.cancelRefinement();resolve();},{once:true}));extension.loseContext();await lost;
    const ready=new Promise<void>(resolve=>canvas.addEventListener('webglcontextrestored',()=>{renderer.restore();resolve();},{once:true}));await new Promise(resolve=>setTimeout(resolve,100));extension.restoreContext();await ready;
    renderer.resize(9,7);await renderer.refine(scene);restored=renderer.getSnapshot();
   }
   return {rows,before,after,screenPoint,afterPoint,afterRepeat,png:{size:png.size,type:png.type},repeated:{size:repeated.size,type:repeated.type},restored};
  }finally{renderer.dispose();}
 });
 for(const row of result.rows){
  expect(row.stats.kernelVariant,row.id).toBe(`binary64-u32-v2:${['nova','newton'].includes(row.id)?'reciprocal':'reference'}`);expect(row.stats.kernelFallback).toBeUndefined();
  expect(row.point.status,row.id).toBe(row.cpu.status);expect(row.point.root,row.id).toBe(row.cpu.root);expect(Math.abs(row.point.value-row.cpu.value),row.id).toBeLessThanOrEqual(2/256);
  expect(row.colorComputations,row.id).toBe(row.stats.computations);
 }
 expect(result.png.type).toBe('image/png');expect(result.png.size).toBeGreaterThan(0);expect(result.after.computations).toBe(result.before.computations+1);expect(result.after.kernelVariant).toBe('binary64-u32-v2:reciprocal');
 expect(result.afterPoint).toEqual(result.screenPoint);expect(result.after.phase).toBe(result.before.phase);
 expect(result.afterRepeat.computations).toBe(result.after.computations);expect(result.repeated).toEqual(result.png);
 if(result.restored){expect(result.restored.kernelVariant).toBe('binary64-u32-v2:reciprocal');expect(result.restored.kernelFallback).toBeUndefined();expect(result.restored.phase).toBe('precise');}
});
