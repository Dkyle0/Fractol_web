import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('kernel-oracle');
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const output=process.env.KERNEL_OUTPUT||'kernel-oracle',fixturePath=process.env.KERNEL_FIXTURE;
if(!fixturePath)throw Error('Set KERNEL_FIXTURE to a fixture created by scripts/kernel-reference.py --output <file>');
const variants=(process.env.KERNEL_VARIANTS||'reference,reciprocal').split(','),source=process.env.KERNEL_SOURCE||'/src';
if(!/^[a-z0-9._-]+$/i.test(output)||variants.some(value=>!['reference','reciprocal','fast','radix4','blocks','combined','estimate','reciprocal-estimate'].includes(value)))throw Error('Invalid oracle configuration');
const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
const path=`${artifactsRoot}/${output}.json`,report={method:'kernel-decimal-oracle-v1',recordedAt:new Date().toISOString(),fixturePath,source,variants,status:'running',results:[]};
await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});
let browser;
try{
 browser=await chromium.launch({channel:'chrome'});report.browser=browser.version();
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/src/rendering/binary64.ts');
 for(const variant of variants){
  const result=await page.evaluate(async({source,variant,primitives,inverses,hasInverses})=>{
   const {binary64Source}=await import(`${source}/rendering/binary64.ts`),{kernelFeatures}=await import(`${source}/rendering/kernel.ts`),{probeBinary64}=await import(`${source}/rendering/binary64Probe.ts`);
   const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,depth:false,stencil:false});
   if(!gl)throw Error('WebGL2 unavailable');
   const vertex=`#version 300 es
   const vec2 p[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));void main(){gl_Position=vec4(p[gl_VertexID],0.,1.);}`;
   const decode=raw=>{const buffer=new ArrayBuffer(8),view=new DataView(buffer);view.setUint32(0,raw[0],true);view.setUint32(4,raw[1],true);return view.getFloat64(0,true);};
   async function run(cases,inverse){
    const program=gl.createProgram(),shaders=[];
    try{
     const fragment=`#version 300 es
     precision highp float;precision highp int;uniform highp usampler2D u_inputs;layout(location=0)out uvec4 result;
     ${binary64Source(variant)}
     void main(){uvec4 v=texelFetch(u_inputs,ivec2(int(gl_FragCoord.x),0),0);int op=int(gl_FragCoord.y);
     ${inverse?'uvec2 r=uvec2(0u),i=uvec2(0u);bool ok=cInverseFast(v.xy,v.zw,r,i);result=op==0?uvec4(r,i):uvec4(uint(ok),0u,0u,0u);':'uvec2 a=v.xy,b=v.zw,r;if(op==0)r=dadd(a,b);else if(op==1)r=dsub(a,b);else if(op==2)r=dmul(a,b);else r=ddiv(a,b);result=uvec4(r,uint(dlt(a,b)),uint(deq(a,b)));'}}`;
     for(const [type,text] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,text);gl.compileShader(shader);gl.attachShader(program,shader);}
     gl.linkProgram(program);const extension=gl.getExtension('KHR_parallel_shader_compile'),started=performance.now();
     while(extension&&!gl.getProgramParameter(program,extension.COMPLETION_STATUS_KHR)){if(performance.now()-started>120000)throw Error('Oracle compile timeout');await new Promise(resolve=>setTimeout(resolve,8));}
     if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)+' '+shaders.map(shader=>gl.getShaderInfoLog(shader)).join('\n'));
     const pairs=cases.map(value=>[decode(value.input.slice(0,2)),decode(value.input.slice(2,4))]);
     return [...(await probeBinary64(gl,program,pairs)).words];
    }finally{gl.deleteProgram(program);shaders.forEach(shader=>gl.deleteShader(shader));}
   }
   try{return {variant,features:kernelFeatures(variant),primitiveWords:await run(primitives,false),inverseWords:hasInverses&&kernelFeatures(variant).reciprocal?await run(inverses,true):null,glError:gl.getError()};}
   catch(error){return {variant,error:String(error)};}
   finally{gl.getExtension('WEBGL_lose_context')?.loseContext();}
  },{source,variant,primitives:fixture.primitives,inverses:fixture.inverses,hasInverses:fixture.inverses.length>0});
  report.results.push(result);await writeFile(path,JSON.stringify(report,null,2));console.log(`${variant}: ${result.error||'GPU raw words saved'}`);
 }
 const verification=`${artifactsRoot}/${output}-verified.json`;
 execFileSync('python',['scripts/kernel-reference.py','--fixture',fixturePath,'--verify',path,'--output',verification],{windowsHide:true,stdio:'pipe'});
 report.verification=verification;report.status='passed';
}catch(error){report.status='failed';report.reason=String(error);if(error.stdout)report.oracleStdout=String(error.stdout);if(error.stderr)report.oracleStderr=String(error.stderr);process.exitCode=1;}
finally{await browser?.close();report.finishedAt=new Date().toISOString();await writeFile(path,JSON.stringify(report,null,2));console.log(`${report.status}: ${path}`);}
