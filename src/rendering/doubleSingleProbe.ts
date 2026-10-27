import { doubleSingleGLSL,splitDouble } from './doubleSingle';
import { gpuCompletion,canReleaseGpuResources } from './gpuCompletion';
export const doubleSinglePairs:readonly (readonly [number,number])[]=[
 [1+2**-30,1],[1,2**-40],[Math.PI,Math.E],[-.743643887037151,.13182590420533],
 [1e-12,3.25],[1e12,.0001],[1e-18,1e-12],[-2,2],[0,1],
];
export const doubleSingleProbeShader=`#version 300 es
precision highp float;precision highp int;
uniform vec4 u_pairs[${doubleSinglePairs.length}];
layout(location=0) out uvec4 result;
${doubleSingleGLSL}
void main(){vec4 v=u_pairs[int(gl_FragCoord.x)];vec2 r;
 int op=int(gl_FragCoord.y);if(op==0)r=ds_add(v.xy,v.zw);else if(op==1)r=ds_sub(v.xy,v.zw);else if(op==2)r=ds_mul(v.xy,v.zw);else r=ds_div(v.xy,v.zw);
 result=uvec4(floatBitsToUint(r),0u,0u);}`;
export async function probeDoubleSingle(gl:WebGL2RenderingContext,program:WebGLProgram,present:()=>void=()=>{},ensureActive:()=>void=()=>{},canRelease?:()=>boolean) {
 const fb=gl.createFramebuffer(),texture=gl.createTexture(),vao=gl.createVertexArray();
 try{
  if(!fb||!texture||!vao)throw Error('Не удалось проверить расширенный предпросмотр.');
  gl.bindVertexArray(vao);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32UI,doubleSinglePairs.length,4,0,gl.RGBA_INTEGER,gl.UNSIGNED_INT,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Расширенный предпросмотр недоступен на устройстве.');
  gl.useProgram(program);gl.uniform1f(gl.getUniformLocation(program,'u_one'),1);gl.uniform1f(gl.getUniformLocation(program,'u_split'),4097);
  gl.uniform4fv(gl.getUniformLocation(program,'u_pairs[0]'),new Float32Array(doubleSinglePairs.flatMap(([a,b])=>[...splitDouble(a),...splitDouble(b)])));
  gl.viewport(0,0,doubleSinglePairs.length,4);gl.drawArrays(gl.TRIANGLES,0,3);present();await gpuCompletion(gl,undefined,ensureActive,undefined,canRelease);ensureActive();
  const words=new Uint32Array(doubleSinglePairs.length*16);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.readPixels(0,0,doubleSinglePairs.length,4,gl.RGBA_INTEGER,gl.UNSIGNED_INT,words);
  const floats=new Float32Array(words.buffer),ops=[(a:number,b:number)=>a+b,(a:number,b:number)=>a-b,(a:number,b:number)=>a*b,(a:number,b:number)=>a/b],failures:string[]=[];
  for(let op=0;op<4;op++)doubleSinglePairs.forEach(([a,b],i)=>{const offset=(op*doubleSinglePairs.length+i)*4,actual=floats[offset]!+floats[offset+1]!,expected=ops[op]!(a,b);
   if(!Number.isFinite(actual)||Math.abs(actual-expected)>Math.max(1e-35,Math.abs(expected)*2**-40))failures.push(`${op}(${a},${b}): ${actual} / ${expected}`);
  });return failures;
 }finally{if(canReleaseGpuResources(ensureActive,canRelease)&&!gl.isContextLost()){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(fb);gl.deleteTexture(texture);gl.deleteVertexArray(vao);present();}}
}
