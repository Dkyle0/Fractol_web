import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('kernel-microbench');
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const output=process.env.KERNEL_MICRO_OUTPUT||'kernel-microbench',source=process.env.KERNEL_SOURCE||'/src',variants=(process.env.KERNEL_VARIANTS||'reference,reciprocal').split(','),operations=(process.env.KERNEL_OPERATIONS||'add,multiply,divide,inverse,short-program').split(',');
if(!/^[a-z0-9._-]+$/i.test(output))throw Error('Invalid output name');
if(variants.some(value=>!['reference','reciprocal','fast','radix4','blocks','combined','estimate','reciprocal-estimate'].includes(value))||operations.some(value=>!['add','multiply','divide','inverse','short-program'].includes(value)))throw Error('Invalid microbenchmark configuration');
const path=`${artifactsRoot}/${output}.json`,load=()=>{try{return execFileSync('nvidia-smi.exe',['--query-gpu=name,utilization.gpu,power.draw,clocks.sm','--format=csv,noheader'],{encoding:'utf8',windowsHide:true}).trim();}catch{return null;}};
const report={method:'kernel-microbench-v2',recordedAt:new Date().toISOString(),source,variants,status:'running',conditions:'64x64 independent dependency chains; at least 500ms steady warmup and five timed draws per operation/variant. Asynchronous EXT GPU queries only; CPU submission/fence latency are separate. Per-operation telemetry and exact shader hashes expose drift. Synthetic workloads guide selection, not full-scene acceptance.',backgroundBefore:load(),results:[]};
await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});let browser;
try{
 browser=await chromium.launch({channel:'chrome'});report.browser=browser.version();const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/src/rendering/binary64.ts');
 await page.exposeFunction('microCheckpoint',async result=>{report.results.push(result);await writeFile(path,JSON.stringify(report,null,2));console.log(`${result.variant}/${result.operation}: GPU median ${result.medianGpuMs} ms`);});
 await page.exposeFunction('microLoad',()=>({recordedAt:new Date().toISOString(),value:load()}));
 await page.evaluate(async({source,variants,operations})=>{
  const {binary64Source}=await import(`${source}/rendering/binary64.ts`),{kernelFeatures}=await import(`${source}/rendering/kernel.ts`),{gpuCompletion}=await import(`${source}/rendering/gpuCompletion.ts`);
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,depth:false,stencil:false});if(!gl)throw Error('WebGL2 unavailable');
  const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!timer)throw Error('GPU timer unavailable; no CPU substitute');
  const vao=gl.createVertexArray(),framebuffer=gl.createFramebuffer(),texture=gl.createTexture();gl.bindVertexArray(vao);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32UI,64,64,0,gl.RGBA_INTEGER,gl.UNSIGNED_INT,null);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete microbenchmark target');gl.disable(gl.DITHER);gl.disable(gl.BLEND);gl.viewport(0,0,64,64);
  const vertex=`#version 300 es
  const vec2 p[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));void main(){gl_Position=vec4(p[gl_VertexID],0.,1.);}`;
  try{
   for(const variant of variants)for(const [operation,iterations] of [['add',512],['multiply',256],['divide',32],['inverse',16],['short-program',8]].filter(([operation])=>operations.includes(operation))){
    const program=gl.createProgram(),shaders=[],features=kernelFeatures(variant),started=performance.now();
    try{
     const inverse=features.reciprocal?'if(cInverseFast(x,y,r,i))return;':'';
     const workload={add:'x=dadd(x,uvec2(0u,0x3eb00000u));',multiply:'x=dmul(x,factor);',divide:'x=ddiv(x,factor);',inverse:'uvec2 r,i;inverseComplex(x,y,r,i);x=r;y=i;',
      // A dependent scalar ALU program, deliberately one reachable copy of
      // each primitive. Full Nova is measured separately by the renderer.
      'short-program':'x=dadd(x,y);y=dsub(y,x);x=dmul(x,factor);y=ddiv(y,factor);'}[operation];
     const fragment=`#version 300 es
     precision highp float;precision highp int;layout(location=0)out uvec4 result;uniform int u_repeat;uniform uint u_seed;
     ${binary64Source(variant)}
     void cmul(uvec2 x,uvec2 y,uvec2 a,uvec2 b,out uvec2 r,out uvec2 i){r=dsub(dmul(x,a),dmul(y,b));i=dadd(dmul(x,b),dmul(y,a));}
     void inverseComplex(uvec2 x,uvec2 y,out uvec2 r,out uvec2 i){${inverse}uvec2 n=dadd(dmul(x,x),dmul(y,y));r=ddiv(x,n);i=neg(ddiv(y,n));}
     void main(){uvec2 x=uvec2(uint(gl_FragCoord.x)*29u+u_seed,0x3ff10000u),y=uvec2(uint(gl_FragCoord.y)*13u+u_seed,0x3fd10000u),factor=uvec2(0u,0x3ff00001u);for(int n=0;n<u_repeat;n++){${workload}}result=uvec4(x,y);}`;
     for(const [type,text] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,text);gl.compileShader(shader);gl.attachShader(program,shader);}
     gl.linkProgram(program);const parallel=gl.getExtension('KHR_parallel_shader_compile');while(parallel&&!gl.getProgramParameter(program,parallel.COMPLETION_STATUS_KHR)){if(performance.now()-started>120000)throw Error('Micro compile timeout');await new Promise(resolve=>setTimeout(resolve,8));}
     if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)+' '+shaders.map(shader=>gl.getShaderInfoLog(shader)).join('\n'));
     const preparationMs=performance.now()-started;gl.useProgram(program);gl.uniform2i(gl.getUniformLocation(program,'u_arithmeticLoops'),55,4);gl.uniform1i(gl.getUniformLocation(program,'u_repeat'),iterations);
     const warmStart=performance.now();let warmups=0;do{gl.uniform1ui(gl.getUniformLocation(program,'u_seed'),17+warmups%7);gl.drawArrays(gl.TRIANGLES,0,3);await gpuCompletion(gl);warmups++;}while(warmups<2||performance.now()-warmStart<500);
     const warmupMs=performance.now()-warmStart,before=await window.microLoad(),samples=[];
     for(let sample=0;sample<5;sample++){
      gl.uniform1ui(gl.getUniformLocation(program,'u_seed'),sample+17);const query=gl.createQuery();
      if(query)gl.beginQuery(timer.TIME_ELAPSED_EXT,query);const submit=performance.now();gl.drawArrays(gl.TRIANGLES,0,3);if(query)gl.endQuery(timer.TIME_ELAPSED_EXT);const submissionMs=performance.now()-submit,waiting=performance.now();await gpuCompletion(gl);
      if(query){while(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))await new Promise(resolve=>setTimeout(resolve,0));const disjoint=!!gl.getParameter(timer.GPU_DISJOINT_EXT);samples.push({index:sample,disjoint,gpuMs:disjoint?null:gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6,submissionMs,fenceWallMs:performance.now()-waiting});gl.deleteQuery(query);}
     }
     const readback=new Uint32Array(4);gl.readPixels(0,0,1,1,gl.RGBA_INTEGER,gl.UNSIGNED_INT,readback);
     const valid=samples.filter(sample=>!sample.disjoint).map(sample=>sample.gpuMs).sort((a,b)=>a-b);
     const shaderHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fragment)))].map(value=>value.toString(16).padStart(2,'0')).join('');
     await window.microCheckpoint({variant,features,operation,width:64,height:64,iterations,shaderHash,preparationMs,warmups,warmupMs,before,after:await window.microLoad(),samples,medianGpuMs:valid.length?valid[Math.floor(valid.length/2)]:null,readback:[...readback],glError:gl.getError()});
    }finally{gl.deleteProgram(program);shaders.forEach(shader=>gl.deleteShader(shader));}
   }
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteVertexArray(vao);}
 },{source,variants,operations});
 report.status=report.results.length===variants.length*operations.length&&report.results.every(result=>result.medianGpuMs!==null&&result.glError===0)?'completed':'failed';if(report.status!=='completed')process.exitCode=1;
}catch(error){report.status='error';report.reason=String(error);process.exitCode=1;}
finally{await browser?.close();report.finishedAt=new Date().toISOString();report.backgroundAfter=load();await writeFile(path,JSON.stringify(report,null,2));console.log(`${report.status}: ${path}`);}
