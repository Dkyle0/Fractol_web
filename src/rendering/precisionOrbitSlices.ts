import { preciseInterpreterSource } from './preciseInterpreter';
import type {KernelVariant} from './kernel';

/** Yield only at orbit boundaries. Four binary64 values plus metadata suffice;
 * expression temporaries are never persisted. ALU and encoding stay unchanged.
 */
export function precisionSliceShader(registers=128,kernel:KernelVariant='reference',compact=false) {
 const replace=(source:string,from:string,to:string)=>{
  if(!source.includes(from))throw new Error('Precision interpreter layout changed; update slice generation.');
  return source.replace(from,to);
 };
 let source=replace(preciseInterpreterSource(kernel),'out vec4 result;',`uniform highp usampler2D u_saved0,u_saved1,u_savedMeta;
uniform ivec2 u_tileOrigin;
uniform ivec4 u_stateFields;
uniform int u_firstSlice,u_resumePc,u_sliceIterations;
layout(location=0) out uvec4 state0;
layout(location=1) out uvec4 state1;
layout(location=2) out uvec4 stateMeta;`);
 source=replace(source,'void main(){',`void main(){
 ivec2 at=ivec2(gl_FragCoord.xy);
 uvec4 meta=u_firstSlice==1?uvec4(0u):texelFetch(u_savedMeta,at,0);
 uvec4 saved0=u_firstSlice==1?uvec4(0u):texelFetch(u_saved0,at,0);
 uvec4 saved1=u_firstSlice==1?uvec4(0u):texelFetch(u_saved1,at,0);
 if(meta.y!=0u){state0=saved0;state1=saved1;stateMeta=meta;return;}
 vec2 point=gl_FragCoord.xy+vec2(u_tileOrigin);`);
 source=source.replaceAll('df(gl_FragCoord.x-u_resolution.x*.5)','df(point.x-u_resolution.x*.5)').replaceAll('df(gl_FragCoord.y-u_resolution.y*.5)','df(point.y-u_resolution.y*.5)');
 source=replace(source,'    uvec4 instruction=texelFetch',`    if(pc==u_resumePc&&u_firstSlice==0&&n==0){
     r[u_stateFields.x]=saved0.xy;r[u_stateFields.y]=saved0.zw;
     r[u_stateFields.z]=saved1.xy;r[u_stateFields.w]=saved1.zw;n=int(meta.x);
    }
    uvec4 instruction=texelFetch`);
 source=replace(source,'    if(halted)break;pc=next;',`    if(halted)break;pc=next;
    if(pc==u_resumePc&&n>=int(meta.x)+u_sliceIterations)break;`);
 source=replace(source,'  float value=float(n);',`  state0=uvec4(r[u_stateFields.x],r[u_stateFields.y]);
  state1=uvec4(r[u_stateFields.z],r[u_stateFields.w]);
  float value=float(n);`);
 source=replace(source,'  result=vec4(float((packed>>16u)&255u),float((packed>>8u)&255u),float(packed&255u),float(code))/255.;',
  '  stateMeta=uvec4(uint(n),uint(halted),(packed<<8u)|uint(code),0u);');
 if(![32,48,64,128].includes(registers))throw Error('Invalid precision register capacity');
 if(compact){
  source=source.replace('uniform ivec2 u_tileOrigin;',`uniform ivec2 u_tileOrigin;
uniform int u_compacted,u_activeCount,u_tileWidth,u_compactWidth;`);
  source=source.replace(' if(meta.y!=0u)',` if(u_compacted==1&&at.y*u_compactWidth+at.x>=u_activeCount){state0=uvec4(0u);state1=uvec4(0u);stateMeta=uvec4(0u,1u,0u,0u);return;}
 if(meta.y!=0u)`);
  source=source.replace('vec2 point=gl_FragCoord.xy+vec2(u_tileOrigin);',`uint original=u_compacted==1?meta.w:uint(at.y*u_tileWidth+at.x);
 vec2 point=vec2(ivec2(int(original)%u_tileWidth,int(original)/u_tileWidth))+.5+vec2(u_tileOrigin);`);
  source=source.replace('stateMeta=uvec4(uint(n),uint(halted),(packed<<8u)|uint(code),0u);','stateMeta=uvec4(uint(n),uint(halted),(packed<<8u)|uint(code),original);');
 }
 return source.replace('r[128]',`r[${registers}]`);
}
export const precisionPendingShader=`#version 300 es
precision highp float;precision highp int;
uniform highp usampler2D u_status;
out vec4 result;
void main(){if(texelFetch(u_status,ivec2(gl_FragCoord.xy),0).y!=0u)discard;result=vec4(0.);}`;
export const precisionCopyShader=`#version 300 es
precision highp float;precision highp int;
uniform highp usampler2D u_status;
uniform ivec2 u_origin;
out vec4 result;
void main(){uint b=texelFetch(u_status,ivec2(gl_FragCoord.xy)-u_origin,0).z;result=vec4(float(b>>24u),float((b>>16u)&255u),float((b>>8u)&255u),float(b&255u))/255.;}`;
