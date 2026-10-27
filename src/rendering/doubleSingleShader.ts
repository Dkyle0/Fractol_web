import type { SceneState } from '../domain/types';
import { preciseProgram } from './preciseProgram';
import { doubleSingleGLSL,splitDouble } from './doubleSingle';
import {structuredPreviewLoop} from './structuredPreview';
import type {PreviewGenerator} from './previewKernel';

export function doubleSingleProgram(scene:SceneState,width:number,height:number) {
 const program=preciseProgram(scene,width,height,true),initial=new Float32Array(program.registers*2);
 const view=new DataView(program.data.buffer,program.data.byteOffset,program.data.byteLength);
 for(let i=0;i<program.registers;i++)initial.set(splitDouble(view.getFloat64((program.width+i)*16,true)),i*2);
 const instructions=Array.from({length:program.length},(_,i)=>Array.from(program.data.slice(i*4,i*4+4)));
 // Only the control flow/register layout is specialized, never scene values.
 const key=JSON.stringify([instructions,program.offset,program.stateFields,program.output,program.root,program.kind]);
 return {...program,initial,instructions,key,degree:scene.parameters.power};
}
type Program=ReturnType<typeof doubleSingleProgram>;
export function doubleSingleShader(p:Program,flat=false,generator:PreviewGenerator='switch') {
 const r=(n:number)=>`r${n}`,leaders=new Set([0,p.resumePc]);
 p.instructions.forEach(([op,dst,_a],i)=>{if(op!>=7){leaders.add(i+1);if([7,8,9,10,12,16].includes(op!))leaders.add(dst!);if(op===11||op===15){leaders.add(dst!);leaders.add(_a!);}}});
 const starts=[...leaders].filter(i=>i<p.length).sort((a,b)=>a-b);
 const operation=(v:number[],i:number)=>{
  const [op,d,a,b]=v as [number,number,number,number];
  if(op<=6){const expr=op<4?`${['ds_add','ds_sub','ds_mul','ds_div'][op]}(${r(a)},${r(b)})`:op===4?`ds_abs(${r(a)})`:op===5?`-${r(a)}`:r(a);return `${r(d)}=${expr};`;}
  const branch=(condition:string)=>`pc=${condition}?${d}:${i+1};`;
  switch(op){
   case 7:return branch(`ds_lt(${r(b)},${r(a)})`);case 8:return branch(`ds_le(${r(a)},${r(b)})`);
   case 9:return branch(`ds_zero(${r(a)})`);case 10:return branch(`ds_bad(${r(a)})`);
   case 11:return `n++;pc=n>=u_iterations?${d}:${a};`;
   case 12:return `pc=${d};`;case 13:return `code=${a};halted=true;`;
   case 14:return 'n++;';case 15:return `pc=n>=u_iterations?${d}:${a};`;
   case 16:return branch(`any(isnan(${r(a)}))`);default:throw Error('Unsupported preview operation');
  }
 };
 const blocks=starts.map((start,idx)=>{
  const end=starts[idx+1]??p.length,lines=p.instructions.slice(start,end).map((v,j)=>operation(v,start+j));
  const last=p.instructions[end-1]![0]!;
  if(last<=6||last===14)lines.push(`pc=${end};`);
  return `case ${start}:{${lines.join('\n')}break;}`;
 }).join('\n');
 const fields=p.stateFields.map(r),out=p.output.map(r);
 const structured=generator==='structured'?structuredPreviewLoop(p,operation):null;
 if(generator==='structured'&&!structured)throw Error('Структура формулы не поддерживает быстрый предпросмотр.');
 return `#version 300 es
precision highp float;precision highp int;
uniform vec2 u_initial[${p.registers}],u_resolution;
uniform highp usampler2D u_saved0,u_saved1,u_savedMeta;
uniform ivec2 u_tileOrigin;
uniform int u_firstSlice,u_sliceIterations,u_iterations,u_steps;
${flat?'out vec4 result;':'layout(location=0) out uvec4 state0;layout(location=1) out uvec4 state1;layout(location=2) out uvec4 stateMeta;'}
${doubleSingleGLSL}
void main(){
 ${flat?'uvec4 meta=uvec4(0u),saved0=uvec4(0u),saved1=uvec4(0u);':`ivec2 at=ivec2(gl_FragCoord.xy);uvec4 meta=u_firstSlice==1?uvec4(0u):texelFetch(u_savedMeta,at,0);
 uvec4 saved0=u_firstSlice==1?uvec4(0u):texelFetch(u_saved0,at,0),saved1=u_firstSlice==1?uvec4(0u):texelFetch(u_saved1,at,0);
 if(meta.y!=0u){state0=saved0;state1=saved1;stateMeta=meta;return;}`}
 ${Array.from({length:p.registers},(_,i)=>`vec2 r${i}=u_initial[${i}];`).join('\n')}
 vec2 point=gl_FragCoord.xy+vec2(u_tileOrigin)-u_resolution*.5;
 ${r(p.offset[0]!)}=vec2(point.x,0.);${r(p.offset[1]!)}=vec2(point.y,0.);
 int pc=0,n=0,code=254;bool halted=false,resuming=${flat?'false':'u_firstSlice==0'};
 ${structured??`for(int step=0;step<u_steps;step++){
  if(pc==${p.resumePc}&&resuming){${fields[0]}=uintBitsToFloat(saved0.xy);${fields[1]}=uintBitsToFloat(saved0.zw);${fields[2]}=uintBitsToFloat(saved1.xy);${fields[3]}=uintBitsToFloat(saved1.zw);n=int(meta.x);resuming=false;}
  switch(pc){${blocks}}
  if(ds_invalid){code=254;halted=true;}if(halted)break;if(pc==${p.resumePc}&&n>=int(meta.x)+u_sliceIterations)break;
 }`}
 ${flat?'':`state0=uvec4(floatBitsToUint(${fields[0]}),floatBitsToUint(${fields[1]}));state1=uvec4(floatBitsToUint(${fields[2]}),floatBitsToUint(${fields[3]}));`}
 float value=float(n);
 if(code==3){float previous=ds_ln(${out[2]}),current=ds_ln(${out[3]}),threshold=log(1e-10);
  if(previous>threshold&&!ds_zero(${out[3]})&&current<previous){float f=(previous-threshold)/(previous-current);if(!isinf(f)&&!isnan(f))value=float(n-1)+clamp(f,0.,1.);}
  ${p.kind===10?`code=16+int(${r(p.root)}.x);`:''}
 }else if(${p.legacy?'false':'code==255||code==4'}){value=max(0.,float(n)+1.-log(ds_radius(${out[0]},${out[1]}))/log(${p.kind===4?`${Math.max(2,scenePower(p))}.`:'2.'}));}
 // Extended preview has a deliberately narrower range. An invalid orbit is
 // unknown, never published as a mathematically classified interior point.
 if(ds_bad(${out[0]})||ds_bad(${out[1]}))code=254;
 uint packed=uint(clamp(value*256.,0.,16777215.));${flat?'result=vec4(float((packed>>16u)&255u),float((packed>>8u)&255u),float(packed&255u),float(code))/255.;':'stateMeta=uvec4(uint(n),uint(halted),(packed<<8u)|uint(code),0u);'}
}`;
}
// Multibrot degree is structural (power() expands the fixed number of products).
function scenePower(p:Program){return p.degree;}
