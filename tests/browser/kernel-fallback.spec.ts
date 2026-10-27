import {test,expect} from '@playwright/test';

test('candidate arithmetic failure falls back to a verified reference field',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp);
  const r=new FractalRenderer(document.createElement('canvas')),scene=createScene();scene.camera={x:3,y:3,height:.1};scene.iterations=64;
  // Use the actual instance's module identity, including Vite HMR query URLs.
  const prototype=Object.getPrototypeOf(r.library),original=prototype.verifyArithmetic;let candidateProbes=0;
  prototype.verifyArithmetic=function(pairs?:readonly(readonly[number,number])[],kernel?:string){if(kernel==='reference')return original.call(this,pairs,kernel);candidateProbes++;return Promise.resolve(['injected candidate failure']);};
  try{r.setKernelVariant('fast');r.resize(9,7);await r.refine(scene);await r.prepare('mandelbrot','binary64');await r.refine(scene);return {stats:r.getSnapshot(),point:r.readPoint(4,3),precise:r.isPrecise(scene),candidateProbes,error:r.getContext().getError()};}
  finally{prototype.verifyArithmetic=original;r.dispose();}
 });
 expect(result.stats.kernelVariant).toBe('binary64-u32-v2:reference');expect(result.stats.kernelFallback).toContain('injected candidate failure');
 expect(result.precise).toBe(true);expect(result.point.status).toBe('escaped');expect(result.error).toBe(0);
 expect(result.candidateProbes).toBe(1);
});

test('candidate core link failure falls back once and an explicit selection retries it',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',pp='/src/rendering/precisionOrbitSlices.ts',cp='/src/domain/catalog.ts';
  const {FractalRenderer}=await import(rp),{precisionSliceShader}=await import(pp),{createScene}=await import(cp);
  const renderer=new FractalRenderer(document.createElement('canvas')),gl=renderer.getContext(),candidate=precisionSliceShader(128,'fast');
  const originalSource=gl.shaderSource.bind(gl),originalAttach=gl.attachShader.bind(gl),originalParameter=gl.getProgramParameter.bind(gl);
  const candidateShaders=new WeakSet<WebGLShader>(),candidatePrograms=new WeakSet<WebGLProgram>();let inject=true,rejections=0;
  gl.shaderSource=(shader:WebGLShader,source:string)=>{if(source===candidate)candidateShaders.add(shader);originalSource(shader,source);};
  gl.attachShader=(program:WebGLProgram,shader:WebGLShader)=>{if(candidateShaders.has(shader))candidatePrograms.add(program);originalAttach(program,shader);};
  gl.getProgramParameter=(program:WebGLProgram,parameter:number)=>{if(inject&&parameter===gl.LINK_STATUS&&candidatePrograms.has(program)){rejections++;return false;}return originalParameter(program,parameter);};
  const scene=createScene();scene.camera={x:3,y:3,height:.1};scene.iterations=64;
  try{
   renderer.setKernelVariant('fast');renderer.resize(9,7);await renderer.refine(scene);await renderer.prepare('mandelbrot','binary64');
   const fallback=renderer.getSnapshot(),firstPoint=renderer.readPoint(4,3);inject=false;renderer.setKernelVariant('fast');await renderer.refine(scene);
   return {fallback,firstPoint,rejections,retried:renderer.getSnapshot(),point:renderer.readPoint(4,3),error:gl.getError()};
  }finally{gl.shaderSource=originalSource;gl.attachShader=originalAttach;gl.getProgramParameter=originalParameter;renderer.dispose();}
 });
 expect(result.rejections).toBe(1);expect(result.fallback.kernelVariant).toBe('binary64-u32-v2:reference');expect(result.fallback.kernelFallback).toContain('Ошибка подготовки GPU-программы');
 expect(result.retried.kernelVariant).toBe('binary64-u32-v2:fast');expect(result.retried.kernelFallback).toBeUndefined();expect(result.firstPoint.status).toBe('escaped');expect(result.point.status).toBe('escaped');expect(result.error).toBe(0);
});

test('double arithmetic failure rejects the field and a restored context can retry cleanly',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp);
  const canvas=document.createElement('canvas'),r=new FractalRenderer(canvas),gl=r.getContext(),extension=gl.getExtension('WEBGL_lose_context'),scene=createScene();scene.camera={x:3,y:3,height:.1};scene.iterations=64;
  const prototype=Object.getPrototypeOf(r.library),original=prototype.verifyArithmetic;prototype.verifyArithmetic=()=>Promise.resolve(['injected double failure']);
  try{
   r.setKernelVariant('fast');r.resize(9,7);let error='';try{await r.refine(scene);}catch(reason){error=String(reason);}const rejectedPrecise=r.isPrecise(scene);
   prototype.verifyArithmetic=original;if(!extension)return {error,rejectedPrecise,supported:false};
   const lost=new Promise<void>(resolve=>canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();r.cancelRefinement();resolve();},{once:true}));extension.loseContext();await lost;
   const restored=new Promise<void>(resolve=>canvas.addEventListener('webglcontextrestored',()=>{r.restore();resolve();},{once:true}));await new Promise(resolve=>setTimeout(resolve,100));extension.restoreContext();await restored;
   r.resize(9,7);await r.refine(scene);return {error,rejectedPrecise,supported:true,precise:r.isPrecise(scene),point:r.readPoint(4,3),glError:gl.getError(),stats:r.getSnapshot()};
  }finally{prototype.verifyArithmetic=original;r.dispose();}
 });
 expect(result.error).toContain('Самопроверка binary64 не пройдена');expect(result.rejectedPrecise).toBe(false);
 if(result.supported){expect(result.precise).toBe(true);expect(result.point!.status).toBe('escaped');expect(result.glError).toBe(0);expect(result.stats.kernelVariant).toBe('binary64-u32-v2:fast');expect(result.stats.kernelFallback).toBeUndefined();}
});
