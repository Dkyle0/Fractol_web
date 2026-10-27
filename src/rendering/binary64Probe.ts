import { binary64GLSL,binary64Source, doubleWords } from './binary64';
import type {KernelVariant} from './kernel';
import { gpuCompletion,canReleaseGpuResources } from './gpuCompletion';

export const binary64ProbeShader = `#version 300 es
precision highp float; precision highp int;
uniform highp usampler2D u_inputs;
layout(location=0) out uvec4 result;
${binary64GLSL}
void main(){uvec4 v=texelFetch(u_inputs,ivec2(int(gl_FragCoord.x),0),0);int op=int(gl_FragCoord.y);
 uvec2 a=v.xy,b=v.zw,r;
 if(op==0)r=dadd(a,b);else if(op==1)r=dsub(a,b);else if(op==2)r=dmul(a,b);else r=ddiv(a,b);
 result=uvec4(r,uint(dlt(a,b)),uint(deq(a,b)));}
`;
export function binary64ProbeSource(kernel:KernelVariant='reference'){return binary64ProbeShader.replace(binary64GLSL,binary64Source(kernel));}
export function inverseProbeSource(kernel:KernelVariant){return `#version 300 es
precision highp float;precision highp int;
uniform highp usampler2D u_inputs;
layout(location=0) out uvec4 result;
${binary64Source(kernel)}
void main(){uvec4 v=texelFetch(u_inputs,ivec2(int(gl_FragCoord.x),0),0);uvec2 real,imag;
bool valid=cInverseFast(v.xy,v.zw,real,imag);result=uvec4(int(gl_FragCoord.y)==0?real:imag,uint(valid),0u);}`;}
/** Small startup guard with exactly representable answers, plus rejected axes. */
export const inverseSelfTests:[number,number][]=[[1,1],[-1,1],[2,-2],[2**100,2**100],[2**-100,-(2**-100)],[0,1],[1,0],[Infinity,1],[2**500,1]];
export function checkInverseSelfTest(words:Uint32Array) {
  const failures:string[]=[];
  inverseSelfTests.forEach(([x,y],i)=>{
    const valid=i<5;
    for(let component=0;component<2;component++){
      const at=(component*inverseSelfTests.length+i)*4;
      if(Boolean(words[at+2])!==valid)failures.push(`inverse guard ${i}`);
      if(valid){const expected=doubleWords(component===0?.5/x:-.5/y);if(words[at]!==expected[0]||words[at+1]!==expected[1])failures.push(`inverse value ${i}/${component}`);}
    }
  });return failures;
}

/** Diagnostic/self-test readback; not part of interactive frame collection. */
export async function probeBinary64(gl: WebGL2RenderingContext, program: WebGLProgram, pairs: readonly (readonly [number, number])[],present:()=>void=()=>{},ensureActive:()=>void=()=>{},wait?:()=>Promise<void>,canRelease?:()=>boolean) {
  const input = gl.createTexture(), output = gl.createTexture(), fb = gl.createFramebuffer(), vao = gl.createVertexArray();
  try {
    if (!input || !output || !fb || !vao) throw new Error('Недостаточно ресурсов для проверки binary64.');
    gl.bindVertexArray(vao); gl.disable(gl.DITHER); gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input);
    for (const texture of [input, output]) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, pairs.length, 1, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, new Uint32Array(pairs.flatMap(([a, b]) => [...doubleWords(a), ...doubleWords(b)])));
    gl.bindTexture(gl.TEXTURE_2D, output);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, pairs.length, 4, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Буфер проверки binary64 недоступен.');
    gl.bindTexture(gl.TEXTURE_2D, input); gl.useProgram(program); gl.uniform1i(gl.getUniformLocation(program, 'u_inputs'), 0);
    gl.uniform2i(gl.getUniformLocation(program, 'u_arithmeticLoops'), 55, 4);
    gl.viewport(0, 0, pairs.length, 4); gl.drawArrays(gl.TRIANGLES, 0, 3);
    present();const completion=await gpuCompletion(gl,undefined,ensureActive,wait,canRelease);ensureActive();
    const words = new Uint32Array(pairs.length * 16);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.readPixels(0, 0, pairs.length, 4, gl.RGBA_INTEGER, gl.UNSIGNED_INT, words);
    return {words,completion};
  } finally {
    if(canReleaseGpuResources(ensureActive,canRelease)&&!gl.isContextLost()){gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(input); gl.deleteTexture(output); gl.deleteVertexArray(vao);}
  }
}

export function checkBinary64(pairs: readonly (readonly [number, number])[], words: Uint32Array) {
  const failures: string[] = [];
  const operations = [(a: number,b: number) => a+b,(a: number,b: number) => a-b,(a: number,b: number) => a*b,(a: number,b: number) => a/b];
  for (let op=0; op<4; op++) pairs.forEach(([a,b],i) => {
    const value = operations[op]!(a,b), expected = Number.isNaN(value) ? [0,0x7ff80000] : doubleWords(value), offset = (op*pairs.length+i)*4;
    if (words[offset] !== expected[0] || words[offset+1] !== expected[1]) failures.push(`op${op}(${a},${b}): ${words[offset]},${words[offset+1]} != ${expected}`);
    if (words[offset+2] !== Number(a<b) || words[offset+3] !== Number(a===b)) failures.push(`comparison(${a},${b})`);
  });
  return failures;
}
export const selfTestPairs: [number, number][] = [
  [1, 2**-53], [1+2**-52, 2**-53], [1, -(1-2**-53)], [Math.PI, Math.E],
  [Number.MAX_VALUE, 2], [Number.MIN_VALUE, 2], [Number.MIN_VALUE, .5], [2**-1022, 1-2**-52],
  [-0,-0], [0,-1], [Infinity,-Infinity], [0,0], [Infinity,0], [NaN,1], [-Number.MIN_VALUE, 3],
];
