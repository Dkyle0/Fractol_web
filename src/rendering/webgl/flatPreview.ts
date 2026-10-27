import type {SceneState} from '../../domain/types';
import type {RenderJob} from '../jobs';
import type {OrbitContext} from './orbitSlicedField';
import {gpuTaskYield,settleFence,submitFence} from '../gpuQueue';
import type {GpuFence} from '../gpuQueue';
import {abortable,canReleaseGpuResources} from '../gpuCompletion';
import {fieldTiles} from '../../domain/fieldTiles';
import {publishFieldTile} from './publishTile';
/** Specialized short orbits, submitted in bounded spatial portions. */
export async function flatPreview(context:OrbitContext,scene:SceneState,width:number,height:number,signal:AbortSignal,job?:RenderJob){
 const {gl,programs,resources,measurements}=context;
 signal.throwIfAborted();context.ensureActive();
 const {program,instructions,generator,fallback}=await abortable(programs.doubleSingle(scene,width,height,true),signal);signal.throwIfAborted();context.ensureActive();
 context.stats.previewGenerator=generator;context.stats.previewGeneratorFallback=fallback;
 context.stats.executor='double-single-tiled';context.stats.submittedSlices=0;context.stats.maxQueuedSlices=0;context.stats.waitMs=0;
 context.stats.registerCapacity=undefined;context.stats.programRegisters=instructions.registers;
 resources.allocate(true,width,height);context.beginField?.();
 gl.bindVertexArray(resources.vao);gl.bindFramebuffer(gl.FRAMEBUFFER,resources.backFramebuffer);gl.viewport(0,0,width,height);gl.useProgram(program.handle);
 const uniform=(name:string)=>programs.uniform(program,name);
 gl.uniform2fv(uniform('u_initial[0]'),instructions.initial);gl.uniform1f(uniform('u_one'),1);gl.uniform1f(uniform('u_split'),4097);
 gl.uniform2f(uniform('u_resolution'),width,height);gl.uniform2i(uniform('u_tileOrigin'),0,0);
 gl.uniform1i(uniform('u_iterations'),scene.iterations);gl.uniform1i(uniform('u_sliceIterations'),scene.iterations+1);gl.uniform1i(uniform('u_steps'),instructions.length*(scene.iterations+2)+32);
 const tasks=gpuTaskYield(),queue:{fence:GpuFence;tile:ReturnType<typeof fieldTiles>[number]}[]=[],tiles=fieldTiles(width,height),started=performance.now();let next=0;
 try{
  while(next<tiles.length||queue.length){
   signal.throwIfAborted();context.ensureActive();
   while(next<tiles.length&&queue.length<2){
    const tile=tiles[next++]!;
    gl.bindVertexArray(resources.vao);gl.bindFramebuffer(gl.FRAMEBUFFER,resources.backFramebuffer);gl.viewport(tile.x,tile.y,tile.width,tile.height);gl.useProgram(program.handle);
    measurements.poll();const timed=measurements.begin({jobId:job?.id,sceneRevision:job?.sceneRevision,contextGeneration:job?.contextGeneration,submittedAt:performance.now(),width,height,kind:'preview',pixels:tile.width*tile.height,iterationSteps:scene.iterations});
    gl.drawArrays(gl.TRIANGLES,0,3);measurements.end(timed);gl.bindFramebuffer(gl.FRAMEBUFFER,null);context.present?.();queue.push({fence:submitFence(gl),tile});
    context.stats.submittedSlices=(context.stats.submittedSlices??0)+1;context.stats.maxQueuedSlices=Math.max(context.stats.maxQueuedSlices??0,queue.length);
   }
   const waitStarted=performance.now(),finished=queue.shift()!;await settleFence(gl,finished.fence,tasks.wait,context.ensureActive,context.canRelease);context.stats.waitMs=(context.stats.waitMs??0)+performance.now()-waitStarted;
   signal.throwIfAborted();context.ensureActive();publishFieldTile(context,finished.tile);
  }
 }finally{
  try{while(queue.length)await settleFence(gl,queue.shift()!.fence,tasks.wait,context.ensureActive,context.canRelease);}finally{
   tasks.dispose();if(canReleaseGpuResources(context.ensureActive,context.canRelease)&&!gl.isContextLost())for(const {fence} of queue.splice(0))gl.deleteSync(fence.sync);
  }
 }
 signal.throwIfAborted();context.ensureActive();measurements.poll();return started;
}
