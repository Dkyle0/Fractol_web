import type {SceneState} from '../../domain/types';
import type {RenderStats} from '../backend';
import type {RenderJob} from '../jobs';
import type {WebGLResources} from './resources';
import type {WebGLPrograms} from './programs';
import type {WebGLMeasurements} from './measurements';
import {preciseProgram} from '../preciseProgram';
import {iterationBudget,fenceIterationBudget,precisionProgress} from '../../domain/precisionSlices';
import {fieldTiles,type FieldTile} from '../../domain/fieldTiles';
import {gpuTaskYield,submitFence,settleFence,type GpuFence} from '../gpuQueue';
import {bindBinary64} from './passes';
import {canReleaseGpuResources,abortable} from '../gpuCompletion';
import {precisionSliceShader} from '../precisionOrbitSlices';
import {ActiveOrbits} from './activeOrbits';
import {shouldCompactOrbits,canProbeActiveOrbits,type OrbitActivitySample} from '../../domain/activeOrbits';
import type {GpuMeasurement} from '../../domain/quality';
import {kernelId} from '../kernel';
import {publishFieldTile} from './publishTile';
export type PrecisionExecutor='serial'|'queue'|'registers'|'profile'|'compact';
export interface OrbitContext {
 gl:WebGL2RenderingContext;resources:WebGLResources;programs:WebGLPrograms;measurements:WebGLMeasurements;stats:RenderStats;
 ensureActive():void;canRelease?():boolean;present?():void;beginField?():void;/** Publishes and presents the visible region. */publishTile?(tile:FieldTile):void;
}
export interface OrbitOptions {executor?:PrecisionExecutor;arithmetic?:'binary64'|'double-single';targetMs?:3|6;onActivity?:(sample:OrbitActivitySample)=>void;/** Isolated experimental fallback; coordinates remain in the original output grid. */tiles?:readonly FieldTile[]}

/** Bounded command queue. Orbit state stays on GPU; only predicates and timers
 * cross to JS. Already-submitted work drains on cancellation. */
export async function orbitSlicedField(context:OrbitContext,scene:SceneState,width:number,height:number,signal:AbortSignal,progress:(fraction:number)=>void,job?:RenderJob,options:OrbitOptions={}) {
 const {gl,resources,programs,measurements,stats,ensureActive}=context;
 const executor=options.executor??'queue',extended=options.arithmetic==='double-single';
 signal.throwIfAborted();ensureActive();
 const preview=extended?await abortable(programs.doubleSingle(scene,width,height),signal):null;
 if(preview){stats.previewGenerator=preview.generator;stats.previewGeneratorFallback=preview.fallback;}
 signal.throwIfAborted();ensureActive();
 let instructions=preview?.instructions??preciseProgram(scene,width,height,false,programs.kernel);
 let program=preview?.program??(executor==='registers'?await abortable(programs.precisionCapacity(instructions.registers),signal):programs.programs.get(programs.precisionKey)!);
 signal.throwIfAborted();ensureActive();
 const pending=programs.programs.get('@precision-pending')!,copy=programs.programs.get('@precision-copy')!;
 const side=Math.min(128,Math.max(width,height)),depth=executor==='serial'?1:2,target=options.targetMs??(executor==='serial'?6:3);
 const textures:WebGLTexture[][]=[[],[]],framebuffers:WebGLFramebuffer[]=[],queue:GpuFence[]=[];
 const query=gl.createQuery(),tasks=gpuTaskYield();if(!query){tasks.dispose();throw Error('Не удалось выделить состояние GPU-расчёта.');}
 const uniform=(p:typeof program,name:string)=>programs.uniform(p,name),started=performance.now();let completed=0;
 let activity:ActiveOrbits|null=null;
 let latestOrbit:GpuMeasurement|null=null,unsubscribeOrbit:(()=>void)|null=null;
 try{
  for(let bank=0;bank<2;bank++){
   const fb=gl.createFramebuffer();if(!fb)throw Error('Не удалось выделить состояние GPU-расчёта.');framebuffers.push(fb);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
   for(let field=0;field<3;field++){
    const texture=gl.createTexture();if(!texture)throw Error('Не удалось выделить состояние GPU-расчёта.');textures[bank]!.push(texture);
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32UI,side,side,0,gl.RGBA_INTEGER,gl.UNSIGNED_INT,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+field,gl.TEXTURE_2D,texture,0);
   }
   gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1,gl.COLOR_ATTACHMENT2]);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Устройство не поддерживает состояние GPU-расчёта.');
  }
  resources.scratchBytes=side*side*16*6;
  stats.compactions=0;stats.activePixels=undefined;stats.activeOriginalPixels=undefined;stats.compactionUnavailable=undefined;
  stats.activityProbes=0;stats.activitySubmitMs=0;stats.activityWaitMs=0;stats.activityReadMs=0;stats.activityDrainMs=0;stats.activityLatencyMs=0;
  if(!extended&&(executor==='profile'||executor==='compact')){
   activity=new ActiveOrbits(context,side,job,width,height);
   try{
    await abortable(activity.prepare(signal),signal);ensureActive();signal.throwIfAborted();
    if(executor==='compact')program=await abortable(programs.cached('@compact:'+programs.precisionKey,()=>precisionSliceShader(128,programs.kernel,true)),signal);
   }catch(error){
    activity.dispose();activity=null;signal.throwIfAborted();ensureActive();stats.compactionUnavailable=String(error);
   }
  }
  if(!program){
   // Compact preparation may fail before its core exists. Prepare the checked
   // ordinary core lazily, then rebuild IR in case arithmetic fell back too.
   await abortable(programs.prepare(scene.fractalId,'binary64'),signal);signal.throwIfAborted();ensureActive();
   instructions=preciseProgram(scene,width,height,false,programs.kernel);program=programs.programs.get(programs.precisionKey)!;
   stats.kernelVariant=kernelId(programs.kernel);stats.kernelFallback=programs.kernelFailure;
  }
  if(activity)unsubscribeOrbit=measurements.subscribe(sample=>{if(sample.stage==='orbit-state')latestOrbit=sample;});
  resources.allocate(true,width,height);context.beginField?.();gl.useProgram(program.handle);
  if(preview){
   gl.uniform2fv(uniform(program,'u_initial[0]'),preview.instructions.initial);gl.uniform1f(uniform(program,'u_one'),1);gl.uniform1f(uniform(program,'u_split'),4097);
   gl.uniform2f(uniform(program,'u_resolution'),width,height);gl.uniform1i(uniform(program,'u_iterations'),scene.iterations);gl.uniform1i(uniform(program,'u_steps'),instructions.length*(scene.iterations+2)+32);
  }else{
   bindBinary64(gl,program,uniform,resources,scene,width,height,instructions);
   gl.uniform4iv(uniform(program,'u_stateFields'),instructions.stateFields);gl.uniform1i(uniform(program,'u_resumePc'),instructions.resumePc);
  }
  for(let field=0;field<3;field++)gl.uniform1i(uniform(program,['u_saved0','u_saved1','u_savedMeta'][field]!),2+field);
  if(gl.getError()!==gl.NO_ERROR)throw Error('Не удалось подготовить состояние GPU-расчёта.');
  const actualExecutor=!activity&&(executor==='profile'||executor==='compact')?'queue':executor;
  stats.phase=extended?'preview':'refining';stats.progress=0;stats.executor=extended?'double-single':options.targetMs?`${actualExecutor}-${target}ms`:actualExecutor;stats.waitMs=0;stats.submittedSlices=0;stats.maxQueuedSlices=0;
  stats.programRegisters=instructions.registers;stats.registerCapacity=extended?undefined:executor==='registers'?[32,48,64,128].find(n=>n>=instructions.registers):128;
  const tiles=options.tiles??fieldTiles(width,height,side),totalPixels=options.tiles?.reduce((sum,tile)=>sum+tile.width*tile.height,0)??width*height;
  for(const tile of tiles){
   const {x,y,width:tw,height:th}=tile,pixels=tw*th,tileStarted=performance.now();
   let first=true,read=0,sent=0,budget=8,usedGpuId=stats.gpuSampleId,queryPending=false,queryStarted=0,queriedIterations=0,finished=false;
   let packed=false,drawWidth=tw,drawHeight=th,activeCount=pixels,previousCompact:number|null=null,lastActivity=0,lastActive=pixels;
   while(!finished){
    signal.throwIfAborted();ensureActive();
    while(queue.length<depth){
     signal.throwIfAborted();const submitted=budget,sliceStarted=performance.now();
     gl.useProgram(program.handle);gl.bindVertexArray(resources.vao);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffers[1-read]!);gl.viewport(0,0,drawWidth,drawHeight);
     if(!extended){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,resources.instructionTexture);}
     for(let field=0;field<3;field++){gl.activeTexture(gl.TEXTURE2+field);gl.bindTexture(gl.TEXTURE_2D,textures[read]![field]!);}
     gl.uniform2i(uniform(program,'u_tileOrigin'),x,y);gl.uniform1i(uniform(program,'u_firstSlice'),Number(first));gl.uniform1i(uniform(program,'u_sliceIterations'),submitted);
     if(activity&&executor==='compact'){
      gl.uniform1i(uniform(program,'u_compacted'),Number(packed));gl.uniform1i(uniform(program,'u_activeCount'),activeCount);gl.uniform1i(uniform(program,'u_tileWidth'),tw);gl.uniform1i(uniform(program,'u_compactWidth'),drawWidth);
     }
     measurements.poll();const timed=measurements.begin({...jobMetadata(job),submittedAt:performance.now(),width,height,kind:extended?'preview':'precision',stage:activity?'orbit-state':undefined,pixels:activeCount,iterationSteps:submitted});
     gl.drawArrays(gl.TRIANGLES,0,3);
     if(activity)measurements.end(timed);
     const completionTimed=activity?measurements.begin({...jobMetadata(job),submittedAt:performance.now(),width,height,kind:'precision',stage:'completion',pixels:activeCount}):false;
     if(!queryPending){
      gl.bindFramebuffer(gl.FRAMEBUFFER,resources.backFramebuffer);gl.useProgram(pending.handle);gl.viewport(0,0,drawWidth,drawHeight);
      gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,textures[1-read]![2]!);gl.uniform1i(uniform(pending,'u_status'),5);
      gl.colorMask(false,false,false,false);gl.beginQuery(gl.ANY_SAMPLES_PASSED,query);gl.drawArrays(gl.TRIANGLES,0,3);gl.endQuery(gl.ANY_SAMPLES_PASSED);gl.colorMask(true,true,true,true);
      queryPending=true;queryStarted=sliceStarted;queriedIterations=sent+submitted;
     }
     measurements.end(activity?completionTimed:timed);gl.bindFramebuffer(gl.FRAMEBUFFER,null);context.present?.();
     queue.push(submitFence(gl));stats.submittedSlices=(stats.submittedSlices??0)+1;stats.maxQueuedSlices=Math.max(stats.maxQueuedSlices??0,queue.length);
     sent+=submitted;first=false;read=1-read;
    }
    const fence=queue.shift()!,waitStarted=performance.now(),completion=await settleFence(gl,fence,tasks.wait,ensureActive,context.canRelease);
    stats.waitMs=(stats.waitMs??0)+performance.now()-waitStarted;signal.throwIfAborted();ensureActive();measurements.poll();
    if(queryPending&&gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){
     finished=!Boolean(gl.getQueryParameter(query,gl.QUERY_RESULT));queryPending=false;
     if(!finished&&queriedIterations>=scene.iterations)throw Error('GPU-расчёт не завершил допустимую программу.');
    }else if(queryPending&&performance.now()-queryStarted>30_000)throw Error('Не удалось получить результат GPU-задачи.');
    const sample:GpuMeasurement|null=activity?latestOrbit:stats.gpuSample;
    if(sample&&sample.kind===(extended?'preview':'precision')&&(!sample.stage||sample.stage==='orbit-state')&&sample.id>usedGpuId&&sample.submittedAt>=tileStarted&&sample.iterationSteps&&sample.pixels===activeCount){budget=iterationBudget(sample.iterationSteps,sample.ms,target);usedGpuId=sample.id;}
    else if(!measurements.available)budget=fenceIterationBudget(budget,completion,programs.fenceFloor??0,target);
    stats.tileTiming=measurements.available?'gpu':'fence';stats.tileLatencyMs=completion.latencyMs;stats.tilePolls=completion.polls;stats.tilePixels=pixels;
    stats.progress=precisionProgress(completed,pixels,sent,scene.iterations,totalPixels);progress(stats.progress);
    if(activity&&!finished){
     let count=executor==='compact'?activity.pollCount(signal):null,countIterations=lastActivity,stable=false;
     const profileDue=executor==='profile'&&sent-lastActivity>=64;
     // A delayed count is only a hint. Current states may have advanced in both
     // banks, so recompute the exact prefix on drained banks before any gather.
     if(profileDue||(count!==null&&shouldCompactOrbits(sent,scene.iterations,count,pixels,previousCompact))){
      const drainStarted=performance.now();
      while(queue.length)await settleFence(gl,queue.shift()!,tasks.wait,ensureActive,context.canRelease);
      stats.activityDrainMs=(stats.activityDrainMs??0)+performance.now()-drainStarted;
      signal.throwIfAborted();ensureActive();
      count=await activity.count(textures[read]![2]!,drawWidth,activeCount,signal);lastActivity=sent;countIterations=sent;stable=true;
     }
     if(count!==null){
      if(count>activeCount)throw Error('Недопустимый счётчик активных орбит.');
      lastActive=count;stats.activePixels=count;stats.activeOriginalPixels=pixels;
      const compact=executor==='compact'&&stable&&shouldCompactOrbits(sent,scene.iterations,count,pixels,previousCompact);
      options.onActivity?.({x,y,iterations:countIterations,remaining:Math.max(0,scene.iterations-countIterations),active:count,pixels,compacted:compact});
      signal.throwIfAborted();ensureActive();
      if(compact){
       activity.publish(textures[read]![2]!,drawWidth,activeCount,tile,width,height);
       activity.pack(textures[read]!,framebuffers[1-read]!,drawWidth,activeCount,count);
       read=1-read;packed=true;drawWidth=side;drawHeight=Math.ceil(count/side);activeCount=count;previousCompact=count;
       stats.compactions=(stats.compactions??0)+1;budget=8;usedGpuId=stats.gpuSampleId;
      }
      if(count===0)finished=true;
     }
     if(executor==='compact'&&!finished&&!activity.countPending&&sent-lastActivity>=64&&canProbeActiveOrbits(scene.iterations-sent,lastActive,previousCompact)){
      activity.submitCount(textures[read]![2]!,drawWidth,activeCount,signal);lastActivity=sent;
     }
    }
   }
   // The predicate may precede another queued slice. Halted states are
   // idempotent; drain before copying the latest state bank.
   while(queue.length)await settleFence(gl,queue.shift()!,tasks.wait,ensureActive,context.canRelease);
   activity?.discardCount();
   measurements.poll();
   signal.throwIfAborted();ensureActive();
   if(activity&&packed)activity.publish(textures[read]![2]!,drawWidth,activeCount,tile,width,height);
   else{
    gl.bindFramebuffer(gl.FRAMEBUFFER,resources.backFramebuffer);gl.useProgram(copy.handle);gl.viewport(x,y,tw,th);
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,textures[read]![2]!);gl.uniform1i(uniform(copy,'u_status'),5);gl.uniform2i(uniform(copy,'u_origin'),x,y);gl.drawArrays(gl.TRIANGLES,0,3);
   }
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);publishFieldTile(context,tile);
   completed+=pixels;stats.progress=completed/totalPixels;progress(stats.progress);
  }
  await settleFence(gl,submitFence(gl),tasks.wait,ensureActive,context.canRelease);signal.throwIfAborted();ensureActive();measurements.poll();
 }finally{
  try{while(queue.length)await settleFence(gl,queue.shift()!,tasks.wait,ensureActive,context.canRelease);}finally{
   unsubscribeOrbit?.();activity?.dispose();tasks.dispose();
   if(canReleaseGpuResources(ensureActive,context.canRelease)&&!gl.isContextLost()){
    for(const fence of queue.splice(0))gl.deleteSync(fence.sync);
    gl.colorMask(true,true,true,true);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteQuery(query);
    for(const bank of textures)for(const texture of bank)gl.deleteTexture(texture);for(const fb of framebuffers)gl.deleteFramebuffer(fb);context.present?.();
   }
   resources.scratchBytes=0;
  }
 }
 return started;
}
const jobMetadata=(job?:RenderJob)=>job?{jobId:job.id,sceneRevision:job.sceneRevision,contextGeneration:job.contextGeneration}:{};
