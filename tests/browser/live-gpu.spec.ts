import {test,expect} from '@playwright/test';
import type {FieldUpdate} from '../../src/rendering/backend';

test('all extended preview definitions agree with independent double on stable points',async({page})=>{
 test.setTimeout(240000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',ep='/src/domain/reference.ts',jp='/src/rendering/jobs.ts';
  const {FractalRenderer}=await import(rp),{fractals,createScene}=await import(cp),{evaluatePoint}=await import(ep),{RenderJobs}=await import(jp);
  const canvas=document.createElement('canvas'),r=new FractalRenderer(canvas),jobs=new RenderJobs(),failures:string[]=[],results=[];
  try{
   for(const f of fractals){
    const scene=createScene(f.id);scene.iterations=128;r.resize(17,13);
    await r.prepare(f.id);await r.preview({scene,job:jobs.begin('preview'),arithmetic:'double-single',interactive:true});
    if(r.stats.previewUnavailable)failures.push(r.stats.previewUnavailable);
    if(r.stats.arithmetic!=='double-single-preview-v1')failures.push(`${f.id}: ${r.stats.arithmetic}`);
    if(r.isPrecise(scene))failures.push(`${f.id}: preview labeled precise`);
    const errors=[];
    for(const [x,y] of [[1,1],[8,6],[13,10]]){
     const px=scene.camera.x+(x+.5-17/2)*scene.camera.height/13,py=scene.camera.y+(y+.5-13/2)*scene.camera.height/13;
     const cpu=evaluatePoint(f.id,px,py,128,scene.parameters),gpu=r.readPoint(x,y);
     if(cpu.status!==gpu.status||cpu.root!==gpu.root||Math.abs(cpu.value-gpu.value)>2/256)errors.push({x,y,cpu,gpu});
    }
    results.push({id:f.id,errors});
    // Exercise checkpoint restoration as well as the short flat program.
    // Use stable landmarks; chaotic boundary differences are not a binary64
    // guarantee of this deliberately approximate preview.
    scene.iterations=1024;
    if(f.id==='julia')scene.camera={x:3,y:3,height:1};
    if(f.id==='newton')scene.camera={x:100,y:0,height:1};
    if(f.id==='nova'){scene.camera={x:.001,y:.001,height:1};scene.parameters.novaRelaxation=.1;}
    r.resize(1,1);await r.preview({scene,job:jobs.begin('preview'),arithmetic:'double-single',interactive:true});
    const cpu=evaluatePoint(f.id,scene.camera.x,scene.camera.y,1024,scene.parameters),gpu=r.readPoint(0,0);
    if(cpu.status!==gpu.status||cpu.root!==gpu.root||Math.abs(cpu.value-gpu.value)>2/256)failures.push(`${f.id} checkpoint: ${JSON.stringify({cpu,gpu})}`);
   }
   const scene=createScene('nova');scene.camera={x:-.4886187166588625,y:.07824630200526818,height:.00019541448104899833};scene.iterations=3584;r.resize(33,19);
   await r.preview({scene,job:jobs.begin('preview'),arithmetic:'double-single',interactive:true});
   results.push({id:'nova-sliced',errors:[],arithmetic:r.stats.arithmetic});
   if(r.stats.previewUnavailable)failures.push(r.stats.previewUnavailable);
   return {failures,results,memory:r.getMemoryEstimate(),canvas:{width:canvas.width,height:canvas.height},stats:r.getSnapshot()};
  }finally{r.dispose();}
 });
 expect(result.failures).toEqual([]);expect(result.results.flatMap(r=>r.errors)).toEqual([]);expect(result.stats.arithmetic).toBe('double-single-preview-v1');expect(result.memory.scratchBytes).toBe(0);
});

test('tiled extended preview preserves coordinates across partial block edges',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',ep='/src/domain/reference.ts',jp='/src/rendering/jobs.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp),{evaluatePoint}=await import(ep),{RenderJobs}=await import(jp);
  const r=new FractalRenderer(document.createElement('canvas')),scene=createScene(),width=273,height=145;
  scene.iterations=128;scene.camera={x:3,y:3,height:1};
  try{
   r.resize(width,height);await r.preview({scene,job:new RenderJobs().begin('preview'),arithmetic:'double-single',interactive:true});
   const failures=[];
   for(const x of [0,1,126,127,128,129,254,255,256,257,271,272])for(const y of [0,1,126,127,128,129,143,144]){
    const re=scene.camera.x+(x+.5-width/2)*scene.camera.height/height,im=scene.camera.y+(y+.5-height/2)*scene.camera.height/height;
    const cpu=evaluatePoint(scene.fractalId,re,im,scene.iterations,scene.parameters),gpu=r.readPoint(x,y);
    if(cpu.status!==gpu.status||cpu.root!==gpu.root||Math.abs(cpu.value-gpu.value)>2/256)failures.push({x,y,cpu,gpu});
   }
   return {failures,stats:r.getSnapshot(),scratch:r.getMemoryEstimate().scratchBytes};
  }finally{r.dispose();}
 });
 expect(result.failures).toEqual([]);expect(result.stats.arithmetic).toBe('double-single-preview-v1');
 expect(result.stats.computeWidth).toBe(273);expect(result.stats.computeHeight).toBe(145);expect(result.scratch).toBe(0);
});

test('cancelled different-size export restores the exact screen field',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp);
  const canvas=document.createElement('canvas'),r=new FractalRenderer(canvas),scene=createScene(),abort=new AbortController();
  scene.camera={x:3,y:3,height:.1};scene.iterations=64;
  try{
   r.resize(9,7);await r.refine(scene);const point=r.readPoint(4,3),before=r.getSnapshot();let rejected=false;
   try{await r.export(scene,17,13,abort.signal,(fraction:number)=>{if(fraction>0)abort.abort(new Error('test cancellation'));});}catch{rejected=true;}
   return {rejected,aborted:abort.signal.aborted,precise:r.isPrecise(scene),before,after:r.getSnapshot(),point,restored:r.readPoint(4,3),surface:[canvas.width,canvas.height],scratch:r.getMemoryEstimate().scratchBytes,error:r.getContext().getError()};
  }finally{r.dispose();}
 });
 expect(result.rejected).toBe(true);expect(result.aborted).toBe(true);expect(result.precise).toBe(true);
 expect(result.after).toMatchObject({width:9,height:7,computeWidth:9,computeHeight:7,phase:'precise'});
 expect(result.restored).toEqual(result.point);expect(result.surface).toEqual([9,7]);expect(result.scratch).toBe(0);expect(result.error).toBe(0);
});

test('context loss during isolated export discards old resources and restores a fresh exact field',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp);
  const canvas=document.createElement('canvas'),r=new FractalRenderer(canvas),gl=r.getContext(),extension=gl.getExtension('WEBGL_lose_context'),scene=createScene();
  if(!extension){r.dispose();return null;}
  scene.camera={x:3,y:3,height:.1};scene.iterations=64;
  try{
   r.resize(9,7);await r.refine(scene);const expected=r.readPoint(4,3);
   r.stats.previewStartedAt=11;r.stats.previewCompletedAt=22;r.stats.previewLatencyMs=999;
   const lost=new Promise<void>(resolve=>canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();r.cancelRefinement();resolve();},{once:true}));
   let triggered=false,rejected=false;
   try{await r.export(scene,17,13,undefined,(fraction:number)=>{if(fraction>0&&!triggered){triggered=true;extension.loseContext();}});}catch{rejected=true;}
   await Promise.race([lost,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('lost event did not arrive')),5000))]);
   const restored=new Promise<void>(resolve=>canvas.addEventListener('webglcontextrestored',()=>{r.restore();resolve();},{once:true}));
   await new Promise(resolve=>setTimeout(resolve,100));extension.restoreContext();
   await Promise.race([restored,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('restored event did not arrive')),5000))]);
   const snapshot=r.getSnapshot(),timingCleared=snapshot.previewStartedAt===undefined&&snapshot.previewCompletedAt===undefined&&snapshot.previewLatencyMs===undefined;
   r.resize(9,7);await r.refine(scene);
   return {triggered,rejected,timingCleared,precise:r.isPrecise(scene),point:r.readPoint(4,3),expected,error:gl.getError(),scratch:r.getMemoryEstimate().scratchBytes};
  }finally{r.dispose();}
 });
 test.skip(result===null,'WEBGL_lose_context unavailable');
 expect(result!.triggered).toBe(true);expect(result!.rejected).toBe(true);expect(result!.precise).toBe(true);
 expect(result!.timingCleared).toBe(true);
 expect(result!.point).toEqual(result!.expected);expect(result!.error).toBe(0);expect(result!.scratch).toBe(0);
});

test('extended coordinates distinguish adjacent pixels below float32 spacing',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',ep='/src/domain/reference.ts',jp='/src/rendering/jobs.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp),{evaluatePoint}=await import(ep),{RenderJobs}=await import(jp);
  const r=new FractalRenderer(document.createElement('canvas')),scene=createScene();scene.camera={x:-2,y:0,height:1e-7};scene.iterations=512;
  try{
   r.resize(17,13);await r.preview({scene,job:new RenderJobs().begin('preview'),arithmetic:'double-single',interactive:true});
   const points=[[7,6],[8,6],[9,6],[8,7]].map(([x,y])=>{
    const re=scene.camera.x+(x!+.5-17/2)*scene.camera.height/13,im=scene.camera.y+(y!+.5-13/2)*scene.camera.height/13;
    return {re,im,floatRe:Math.fround(re),cpu:evaluatePoint('mandelbrot',re,im,512,scene.parameters),gpu:r.readPoint(x!,y!)};
   });
   const stats=r.getSnapshot(),boundary=points[3]!;
   // At the exact radius-two boundary DS can retain an isolated positive low
   // term that binary64 rounds away. Verify the strict result separately.
   r.resize(1,1);scene.camera={x:boundary.re,y:boundary.im,height:1};await r.refine(scene);
   return {points,stats,preciseBoundary:r.readPoint(0,0)};
  }finally{r.dispose();}
 });
 expect(result.points[0]!.floatRe).toBe(result.points[2]!.floatRe);
 expect(result.points[0]!.gpu.status).toBe('escaped');expect(result.points[2]!.gpu.status).toBe('unresolved');
 for(const {cpu,gpu} of result.points.slice(0,3)){expect(gpu.status).toBe(cpu.status);expect(Math.abs(cpu.value-gpu.value)).toBeLessThanOrEqual(2/256);}
 const boundary=result.points[3]!;expect(boundary.gpu.status).toBe(boundary.cpu.status);
 expect(Math.abs(boundary.cpu.value-boundary.gpu.value)).toBeLessThanOrEqual(1+2/256);
 expect(result.preciseBoundary.status).toBe(boundary.cpu.status);expect(Math.abs(boundary.cpu.value-result.preciseBoundary.value)).toBeLessThanOrEqual(2/256);
 expect(result.stats.arithmetic).toBe('double-single-preview-v1');
});

test('bounded register kernels retain binary64 outcomes for every fitting definition',async({page})=>{
 test.setTimeout(240000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',ep='/src/domain/reference.ts',pp='/src/rendering/preciseProgram.ts',sp='/src/rendering/precisionOrbitSlices.ts';
  const {FractalRenderer}=await import(rp),{fractals,createScene}=await import(cp),{evaluatePoint}=await import(ep),{preciseProgram}=await import(pp),{precisionSliceShader}=await import(sp);
  const failures:string[]=[],checked:{capacity:number;id:string}[]=[];
  for(const capacity of [32,48,64,128]){
   const r=new FractalRenderer(document.createElement('canvas')),gl:WebGL2RenderingContext=r.getContext(),source=gl.shaderSource.bind(gl);
   gl.shaderSource=(shader,text)=>source(shader,text===precisionSliceShader()?precisionSliceShader(capacity):text);
   try{
    r.resize(1,1);
    for(const f of fractals){
     const scene=createScene(f.id);scene.iterations=128;
     if(preciseProgram(scene,1,1).registers>capacity)continue;
     for(const [x,y] of [[0,0],[3,3],[-.7,.2]]){
      scene.camera={x,y,height:1};await r.refine(scene);
      const cpu=evaluatePoint(f.id,x,y,128,scene.parameters),gpu=r.readPoint(0,0);
      if(cpu.status!==gpu.status||cpu.root!==gpu.root||Math.abs(cpu.value-gpu.value)>2/256)failures.push(JSON.stringify({capacity,id:f.id,x,y,cpu,gpu}));
     }
     checked.push({capacity,id:f.id});
    }
   }finally{r.dispose();}
  }
  return {failures,checked};
 });
 expect(result.failures).toEqual([]);
 for(const capacity of [32,48,64,128])expect(result.checked.some(v=>v.capacity===capacity)).toBe(true);
 expect(new Set(result.checked.map(v=>v.id)).size).toBe(14);
});

test('extended overflow and underflow stay unknown until strict classification',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const results=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',ep='/src/domain/reference.ts',jp='/src/rendering/jobs.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp),{evaluatePoint}=await import(ep),{RenderJobs}=await import(jp);
  const r=new FractalRenderer(document.createElement('canvas')),gl:WebGL2RenderingContext=r.getContext(),read=gl.readPixels.bind(gl),codes:number[]=[],results=[];
  Object.defineProperty(gl,'readPixels',{value:(...args:unknown[])=>{Reflect.apply(read,gl,args);if(args[6] instanceof Uint8Array)codes.push(args[6][3]!);}});
  try{
   r.resize(1,1);
   for(const id of ['mandelbrot','julia'] as const){
    const scene=createScene(id);scene.iterations=64;scene.camera={x:id==='mandelbrot'?1e20:1e-20,y:0,height:1};scene.parameters.juliaRe=0;scene.parameters.juliaIm=0;
    await r.prepare(id);await r.preview({scene,job:new RenderJobs().begin('preview'),arithmetic:'double-single',interactive:true});r.readPoint(0,0);const previewCode=codes.at(-1);
    await r.refine(scene);const exact=r.readPoint(0,0),cpu=evaluatePoint(id,scene.camera.x,0,64,scene.parameters);
    results.push({id,previewCode,exactCode:codes.at(-1),exact,cpu});
   }return results;
  }finally{r.dispose();}
 });
 for(const result of results){expect(result.previewCode).toBe(254);expect(result.exactCode).not.toBe(254);expect(result.exact.status).toBe(result.cpu.status);expect(Math.abs(result.exact.value-result.cpu.value)).toBeLessThanOrEqual(2/256);}
});

test('exact fields progressively publish center first and coarse work does not resize the canvas',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',jp='/src/rendering/jobs.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp),{RenderJobs}=await import(jp);
  const canvas=document.createElement('canvas'),r=new FractalRenderer(canvas),scene=createScene(),jobs=new RenderJobs(),events:{tile:unknown;complete:boolean;precise:boolean;canvas:number[]}[]=[];
  try{
   r.resize(273,145);await r.prepare(scene.fractalId);r.draw(scene);
   const off=r.subscribeFields((e:FieldUpdate)=>events.push({tile:e.tile,complete:e.complete,precise:r.isPrecise(scene),canvas:[canvas.width,canvas.height]}));
   await r.refineField({scene,job:jobs.begin('refine'),width:33,height:19});const coarseCanvas=[canvas.width,canvas.height];
   events.length=0;await r.refineField({scene,job:jobs.begin('refine')});off();const end=r.getSnapshot();
   const draws=end.draws;await new Promise(resolve=>setTimeout(resolve,100));return {coarseCanvas,events,end,idle:r.stats.draws-draws};
  }finally{r.dispose();}
 });
 expect(result.coarseCanvas).toEqual([273,145]);expect(result.events[0]!.tile).toEqual({x:128,y:0,width:128,height:128});
 expect(result.events.slice(0,-1).every(e=>!e.precise)).toBe(true);expect(result.events.at(-1)!.precise).toBe(true);expect(result.end.maxQueuedSlices).toBeLessThanOrEqual(2);expect(result.idle).toBe(0);
});

test('extended preview retains the requested orbit limit and exact PNG reuses a completed field',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',jp='/src/rendering/jobs.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp),{RenderJobs}=await import(jp);
  const canvas=document.createElement('canvas'),r=new FractalRenderer(canvas),jobs=new RenderJobs(),scene=createScene('julia');
  try{
   // c=0, z=0 remains unresolved for the entire user limit. A tiny field keeps
   // this a contract check rather than a performance test.
   scene.parameters.juliaRe=0;scene.parameters.juliaIm=0;scene.camera={x:0,y:0,height:1e-5};scene.iterations=16384;
   r.resize(1,1,{width:97,height:61});await r.prepare(scene.fractalId);
   const pending=r.preview({scene,job:jobs.begin('preview'),arithmetic:'double-single',interactive:true});
   scene.coloring.phase=.2;
   const reused=r.preview({scene,job:jobs.begin('preview'),arithmetic:'double-single',interactive:true})===undefined;
   await pending;
   const preview={...r.getSnapshot()},surface=[canvas.width,canvas.height],point=r.readPoint(0,0);
   scene.coloring.phase=.3;const before=r.stats.computations;r.recolor(scene);const recolorComputations=r.stats.computations-before;
   r.resize(9,7);await r.refineField({scene,job:jobs.begin('refine')});
   const exact=r.stats.computations,screenPoint=r.readPoint(4,3),blob=await r.exportFrame({scene,width:9,height:7,arithmetic:'binary64',job:jobs.begin('export')});
   const pngComputations=r.stats.computations-exact,afterPoint=r.readPoint(4,3),screenPrecise=r.isPrecise(scene),beforeRepeat=r.stats.computations;
   const repeated=await r.exportFrame({scene,width:9,height:7,arithmetic:'binary64',job:jobs.begin('export')});
   return {preview,surface,point,reused,recolorComputations,pngComputations,repeatComputations:r.stats.computations-beforeRepeat,screenPoint,afterPoint,screenPrecise,blob:{size:blob.size,type:blob.type},repeated:{size:repeated.size,type:repeated.type},scratch:r.getMemoryEstimate().scratchBytes};
  }finally{r.dispose();}
 });
 expect(result.preview.arithmetic).toBe('double-single-preview-v1');expect(result.preview.submittedSlices).toBeGreaterThan(32);
 expect(result.reused).toBe(true);expect(result.preview.computations).toBe(1);
 expect(result.point.status).toBe('unresolved');expect(result.point.value).toBe(16384);expect(result.surface).toEqual([97,61]);expect(result.recolorComputations).toBe(0);
 expect(result.pngComputations).toBe(1);expect(result.repeatComputations).toBe(0);expect(result.afterPoint).toEqual(result.screenPoint);expect(result.screenPrecise).toBe(true);
 expect(result.blob.type).toBe('image/png');expect(result.blob.size).toBeGreaterThan(50);expect(result.repeated).toEqual(result.blob);expect(result.scratch).toBe(0);
});

test('obsolete extended jobs cannot publish over the next scene',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',jp='/src/rendering/jobs.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp),{RenderJobs}=await import(jp);
  const r=new FractalRenderer(document.createElement('canvas')),jobs=new RenderJobs(),published:number[]=[];
  try{
   r.resize(17,13);await r.prepare('julia');const scene=createScene('julia');scene.iterations=16384;scene.parameters.juliaRe=0;scene.parameters.juliaIm=0;scene.camera={x:0,y:0,height:1e-6};
   const replacement=createScene('newton');replacement.parameters.power=8;replacement.iterations=64;
   // Isolate obsolete-job publication from concurrent cold shader compilation.
   // Newton8 cold preparation has its own diagnostic and retains its deadline.
   await r.preparePreview({scene,arithmetic:'double-single',width:17,height:13});
   await r.preparePreview({scene:replacement,arithmetic:'double-single',width:17,height:13});
   if(r.getSnapshot().previewUnavailable)throw Error(r.getSnapshot().previewUnavailable);
   const gl=r.getContext(),create=gl.createProgram.bind(gl);let racePrograms=0;gl.createProgram=()=>{racePrograms++;return create();};
   const first=jobs.begin('preview'),off=r.subscribeFields((e:FieldUpdate)=>published.push(e.job.id));
   const old=Promise.resolve(r.preview({scene,job:first,arithmetic:'double-single',interactive:true})).then(()=>false,()=>true);
   const deadline=performance.now()+10000;
   while(!(r.getSnapshot().submittedSlices>0)){if(performance.now()>deadline)throw Error('Old Julia did not submit a GPU portion within10s');await new Promise(resolve=>setTimeout(resolve,4));}
   const submittedBeforeCancel=r.getSnapshot().submittedSlices;
   const second=jobs.begin('preview');await r.preview({scene:replacement,job:second,arithmetic:'double-single',interactive:true});
   const cancelled=await old;off();gl.createProgram=create;return {cancelled,published,second:second.id,stats:r.getSnapshot(),scratch:r.getMemoryEstimate().scratchBytes,racePrograms,submittedBeforeCancel};
  }finally{r.dispose();}
 });
 expect(result.cancelled).toBe(true);expect(result.published.every(id=>id===result.second)).toBe(true);
 expect(result.stats.fractalId).toBe('newton');expect(result.stats.previewUnavailable).toBeUndefined();expect(result.scratch).toBe(0);
 expect(result.racePrograms).toBe(0);
 expect(result.submittedBeforeCancel).toBeGreaterThan(0);
});

test('benchmark preparation compiles extended arithmetic before navigation starts',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',sp='/src/rendering/session.ts',cp='/src/domain/catalog.ts',jp='/src/rendering/jobs.ts';
  const {FractalRenderer}=await import(rp),{RenderSession}=await import(sp),{createScene}=await import(cp),{RenderJobs}=await import(jp);
  const r=new FractalRenderer(document.createElement('canvas')),scene=createScene('nova');scene.camera.height=1e-6;
  const session=new RenderSession(r,scene,{stats:()=>{},loading:()=>{},lightGlass:()=>{},error:()=>{}},{now:()=>performance.now(),requestFrame:()=>1,cancelFrame:()=>{},dpr:()=>1,wait:(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))});
  const gl=r.getContext(),create=gl.createProgram.bind(gl);let programs=0;gl.createProgram=()=>{programs++;return create();};
  try{
   session.resize({width:17,height:13});await session.prepare('nova');const prepared=programs,computations=r.stats.computations;
   r.resize(17,13);await r.preview({scene,job:new RenderJobs().begin('preview'),arithmetic:'double-single',interactive:true});
   return {prepared,after:programs,computations,stats:r.getSnapshot()};
  }finally{session.dispose();}
 });
 expect(result.prepared).toBeGreaterThan(3);expect(result.after).toBe(result.prepared);expect(result.computations).toBe(0);expect(result.stats.arithmetic).toBe('double-single-preview-v1');
});

test('failed extended arithmetic keeps viewing in a float32 overview without preparing binary64',async({page})=>{
 test.setTimeout(120000);
 await page.addInitScript(()=>{
  const probe={binary64Draws:0,binary64ShaderSources:0};(window as unknown as {viewingFallbackProbe:typeof probe}).viewingFallbackProbe=probe;
  const original=WebGL2RenderingContext.prototype.shaderSource;
  WebGL2RenderingContext.prototype.shaderSource=function(shader,source){if(source.includes('uvec2 dadd('))probe.binary64ShaderSources++;return original.call(this,shader,source.includes('uniform vec4 u_pairs[')?source.replace('r=ds_add(v.xy,v.zw)','r=ds_sub(v.xy,v.zw)'):source);};
  const draw=WebGL2RenderingContext.prototype.drawArrays,programs=new WeakMap<WebGLProgram,boolean>();
  WebGL2RenderingContext.prototype.drawArrays=function(...args){const program=this.getParameter(this.CURRENT_PROGRAM) as WebGLProgram|null;if(program){if(!programs.has(program))programs.set(program,(this.getAttachedShaders(program)??[]).some(shader=>(this.getShaderSource(shader)??'').includes('uvec2 r[')));if(programs.get(program))probe.binary64Draws++;}return draw.apply(this,args);};
 });
 await page.setViewportSize({width:320,height:240});await page.goto('/?debug=1');await page.waitForFunction(()=>(window.__FRACTOL__?.stats() as {draws:number})?.draws>0);
 const requested=await page.evaluate(()=>{
  const scene=window.__FRACTOL__!.scene();
  scene.camera={x:3,y:3,height:1e-6};scene.iterations=16384;window.__FRACTOL__!.setScene(scene);return scene;
 });
 const explanation=page.locator('.precision-progress');
 await expect(explanation).toContainText('Просмотр ограничен float32 и 2000 итерациями',{timeout:60000});
 await expect(page.getByTestId('overview-notice')).toBeVisible();
 await page.waitForFunction(()=>{const s=window.__FRACTOL__!.stats() as {viewing:{ready:boolean;arithmetic:string;overview:boolean;effectiveIterations:number}};return s.viewing.ready&&s.viewing.arithmetic==='float32'&&s.viewing.overview&&s.viewing.effectiveIterations===2000;},undefined,{timeout:60000});
 expect(await page.evaluate(()=>window.__FRACTOL__!.scene())).toEqual(requested);
 expect(await page.evaluate(()=>((window as unknown as {viewingFallbackProbe:{binary64Draws:number}}).viewingFallbackProbe.binary64Draws))).toBe(0);
 expect(await page.evaluate(()=>((window as unknown as {viewingFallbackProbe:{binary64ShaderSources:number}}).viewingFallbackProbe.binary64ShaderSources))).toBe(0);
 expect(requested.camera).toEqual({x:3,y:3,height:1e-6});expect(requested.iterations).toBe(16384);
 await expect(page.getByText('Изображение недоступно',{exact:true})).toBeHidden();
});
