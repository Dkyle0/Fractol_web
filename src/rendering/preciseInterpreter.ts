import { binary64GLSL,binary64Source,complexInverseGLSL } from './binary64';
import {kernelFeatures,type KernelVariant} from './kernel';

/** Shared integer ALU: formula/parameters are validated bytecode, never user GLSL. */
export const preciseInterpreter = `#version 300 es
precision highp float;precision highp int;
uniform highp usampler2D u_program;
uniform vec2 u_resolution;
uniform int u_registerCount,u_steps,u_iterations,u_root,u_kind,u_legacy,u_power;
uniform ivec2 u_offset;
uniform ivec4 u_output;
out vec4 result;
${binary64GLSL}
float ln64(uvec2 a){Parts p=unpack64(da(a));return log(float(p.m.y)/1048576.+float(p.m.x)/4503599627370496.)+float(p.e)*.6931471805599453;}
float logRadius(uvec2 x,uvec2 y){
  if(dz(x))return ln64(y);if(dz(y))return ln64(x);
  Parts a=unpack64(da(x)),b=unpack64(da(y));int e=max(a.e,b.e);
  float ax=(float(a.m.y)/1048576.+float(a.m.x)/4503599627370496.)*exp2(float(a.e-e));
  float by=(float(b.m.y)/1048576.+float(b.m.x)/4503599627370496.)*exp2(float(b.e-e));
  return .5*log(ax*ax+by*by)+float(e)*.6931471805599453;
}
void main(){
  uvec2 r[128];for(int j=0;j<u_registerCount;j++)r[j]=texelFetch(u_program,ivec2(j,1),0).xy;
  r[u_offset.x]=df(gl_FragCoord.x-u_resolution.x*.5);r[u_offset.y]=df(gl_FragCoord.y-u_resolution.y*.5);
  int pc=0,n=0,code=2;bool halted=false;
  for(int step=0;step<u_steps;step++){
    uvec4 instruction=texelFetch(u_program,ivec2(pc,0),0);int dst=int(instruction.y),a=int(instruction.z),b=int(instruction.w),next=pc+1;
    switch(int(instruction.x)){
      case 0:r[dst]=dadd(r[a],r[b]);break;
      case 1:r[dst]=dsub(r[a],r[b]);break;
      case 2:r[dst]=dmul(r[a],r[b]);break;
      case 3:r[dst]=ddiv(r[a],r[b]);break;
      case 4:r[dst]=da(r[a]);break;
      case 5:r[dst]=neg(r[a]);break;
      case 6:r[dst]=r[a];break;
      case 7:if(dlt(r[b],r[a]))next=dst;break;
      case 8:if(dle(r[a],r[b]))next=dst;break;
      case 9:if(dz(r[a]))next=dst;break;
      case 10:if(dn(r[a])||di(r[a]))next=dst;break;
      case 11:n++;next=n>=u_iterations?dst:a;break;
      case 12:next=dst;break;
      case 13:code=a;halted=true;break;
      case 14:n++;break;
      case 15:next=n>=u_iterations?dst:a;break;
      case 16:if(dn(r[a]))next=dst;break;
    }
    if(halted)break;pc=next;
  }
  float value=float(n);
  if(code==3){
    uvec2 before=r[u_output.z],after=r[u_output.w];
    if(!di(before)&&!dn(before)&&!dz(after)&&dlt(after,before)){
      float previousLog=ln64(before),currentLog=ln64(after),thresholdLog=log(1e-10);
      if(previousLog>thresholdLog){float f=(previousLog-thresholdLog)/(previousLog-currentLog);if(!isinf(f)&&!isnan(f))value=float(n-1)+clamp(f,0.,1.);}
    }
    if(u_kind==10)code=16+int(toFloat(r[u_root]));
  }else if((code==255||code==4)&&u_legacy==0){
    float degree=u_kind==4?float(u_power):2.;
    value=max(0.,float(n)+1.-log(logRadius(r[u_output.x],r[u_output.y]))/log(degree));
  }
  uint packed=uint(clamp(value*256.,0.,16777215.));
  result=vec4(float((packed>>16u)&255u),float((packed>>8u)&255u),float(packed&255u),float(code))/255.;
}`;

export function preciseInterpreterSource(kernel:KernelVariant='reference') {
  const features=kernelFeatures(kernel);
  let source=preciseInterpreter.replace(binary64GLSL,binary64Source(kernel));
  if(features.reciprocal)source=source.replace(complexInverseGLSL,complexInverseGLSL.slice(0,complexInverseGLSL.indexOf('bool cInverseFast')));
  if(features.blocks)source=source.replace('int pc=0,n=0,code=2;bool halted=false;', 'uvec2 pairImag=uvec2(0u);int pc=0,n=0,code=2;bool halted=false;');
  const cases=[
    features.reciprocal?`case 22:{uvec2 x=r[a],y=r[b];bool valid=!(dn(x)||dn(y)||di(x)||di(y)||dz(x)||dz(y));
      int e=0;if(valid){Parts px=unpack64(x),py=unpack64(y);e=max(px.e,py.e);valid=e>=-450&&e<=450&&min(px.e,py.e)-e>=-450;}
      r[dst]=uvec2(uint(-e),uint(valid));break;}
      case 23:if(r[a].y==0u)next=dst;break;
      case 24:r[dst]=dscaleNormal(r[a],int(r[b].x));break;`:'',
    features.blocks?'case 18:r[dst]=pairImag;break;':'',
    features.blocks?`case 19:{uvec2 x=r[a],y=r[b];r[dst]=dsub(dmul(x,x),dmul(y,y));pairImag=dmul(dmul(uvec2(0u,0x40000000u),x),y);break;}
      case 20:r[dst]=dadd(dmul(r[a],r[a]),dmul(r[b],r[b]));break;`:'',
  ].join('\n');
  return source.replace('case 16:if(dn(r[a]))next=dst;break;',`case 16:if(dn(r[a]))next=dst;break;${cases}`);
}
