import {kernelFeatures,type KernelVariant} from './kernel';
import {estimatedDivisionGLSL} from './estimatedDivision';
/** IEEE-754 binary64 words, low word first. No float32 conversion on upload. */
export const ARITHMETIC_VERSION = 'binary64-u32-v1';
export function doubleWords(value: number): [number, number] {
  const buffer = new ArrayBuffer(8), view = new DataView(buffer);
  view.setFloat64(0, value, true);
  return [view.getUint32(0, true), view.getUint32(4, true)];
}

/** Integer-only significand operations: independent of shader contraction/FMA.
 * Internal rounding format: hidden bit at 55, three guard/round/sticky bits.
 */
export const binary64GLSL = `
uniform ivec2 u_arithmeticLoops;
uvec2 uadd(uvec2 a,uvec2 b) { uint lo=a.x+b.x; return uvec2(lo,a.y+b.y+uint(lo<a.x)); }
uvec2 usub(uvec2 a,uvec2 b) { return uvec2(a.x-b.x,a.y-b.y-uint(a.x<b.x)); }
bool ult(uvec2 a,uvec2 b) { return a.y<b.y || (a.y==b.y && a.x<b.x); }
bool uzero(uvec2 a) { return (a.x|a.y)==0u; }
uvec2 ul(uvec2 a,int n) {
  if(n<=0) return a; if(n>=64) return uvec2(0u);
  if(n>=32) return uvec2(0u,a.x<<uint(n-32));
  return uvec2(a.x<<uint(n),(a.y<<uint(n))|(a.x>>uint(32-n)));
}
uvec2 ur(uvec2 a,int n) {
  if(n<=0) return a; if(n>=64) return uvec2(0u);
  if(n>=32) return uvec2(a.y>>uint(n-32),0u);
  return uvec2((a.x>>uint(n))|(a.y<<uint(32-n)),a.y>>uint(n));
}
uvec2 jam(uvec2 a,int n) {
  if(n<=0) return a;
  if(n>=64) return uvec2(uint(!uzero(a)),0u);
  uvec2 r=ur(a,n); r.x|=uint(any(notEqual(ul(r,n),a))); return r;
}
int top32(uint x) {
  int n=0; if(x>=65536u){x>>=16u;n+=16;} if(x>=256u){x>>=8u;n+=8;}
  if(x>=16u){x>>=4u;n+=4;} if(x>=4u){x>>=2u;n+=2;} if(x>=2u)n++;
  return n;
}
int top(uvec2 a) { return a.y!=0u?32+top32(a.y):top32(a.x); }
bool dn(uvec2 a) { return (a.y&0x7ff00000u)==0x7ff00000u && ((a.y&0xfffffu)|a.x)!=0u; }
bool di(uvec2 a) { return (a.y&0x7fffffffu)==0x7ff00000u && a.x==0u; }
bool dz(uvec2 a) { return ((a.y&0x7fffffffu)|a.x)==0u; }
bool ds(uvec2 a) { return (a.y&0x80000000u)!=0u; }
uvec2 nan64() { return uvec2(0u,0x7ff80000u); }
uvec2 inf64(bool sign) { return uvec2(0u,sign?0xfff00000u:0x7ff00000u); }
uvec2 da(uvec2 a) { return uvec2(a.x,a.y&0x7fffffffu); }
uvec2 neg(uvec2 a) { return uvec2(a.x,a.y^0x80000000u); }
struct Parts { uvec2 m; int e; bool s; };
Parts unpack64(uvec2 a) {
  int e=int((a.y>>20u)&2047u);
  uvec2 m=uvec2(a.x,a.y&0xfffffu);
  if(e!=0) { m.y|=0x100000u; e-=1023; }
  else { e=-1022; if(!uzero(m)){int shift=52-top(m);m=ul(m,shift);e-=shift;} }
  return Parts(m,e,ds(a));
}
uvec2 pack64(bool sign,int e,uvec2 m) {
  uint s=sign?0x80000000u:0u;
  if(uzero(m)) return uvec2(0u,s);
  int shift=top(m)-55;
  if(shift>0)m=jam(m,shift); else if(shift<0)m=ul(m,-shift);
  e+=shift;
  if(e < -1022) { m=jam(m,-1022-e);e=-1022; }
  uint remainder=m.x&7u;
  m=ur(m,3);
  if(remainder>4u || (remainder==4u && (m.x&1u)!=0u))m=uadd(m,uvec2(1u,0u));
  if((m.y&0x200000u)!=0u){m=ur(m,1);e++;}
  if(e>1023)return inf64(sign);
  uint exponent=(m.y&0x100000u)!=0u?uint(e+1023):0u;
  return uvec2(m.x,s|(exponent<<20u)|(m.y&0xfffffu));
}
uvec2 dadd(uvec2 a,uvec2 b) {
  if(dn(a)||dn(b))return nan64();
  if(di(a)||di(b)) { if(di(a)&&di(b)&&ds(a)!=ds(b))return nan64();return di(a)?a:b; }
  if(dz(a)&&dz(b))return uvec2(0u,ds(a)&&ds(b)?0x80000000u:0u);
  if(dz(a))return b;if(dz(b))return a;
  Parts x=unpack64(a),y=unpack64(b);
  if(x.e<y.e || (x.e==y.e && ult(x.m,y.m))){Parts t=x;x=y;y=t;}
  uvec2 hi=ul(x.m,3),lo=jam(ul(y.m,3),x.e-y.e);
  if(x.s==y.s)return pack64(x.s,x.e,uadd(hi,lo));
  uvec2 m=usub(hi,lo);return pack64(!uzero(m)&&x.s,x.e,m);
}
uvec2 dsub(uvec2 a,uvec2 b) { return dadd(a,neg(b)); }
uvec2 product32(uint a,uint b) {
  uint a0=a&65535u,a1=a>>16u,b0=b&65535u,b1=b>>16u;
  uint low=a0*b0,t=a1*b0+(low>>16u),middle=(t&65535u)+a0*b1;
  return uvec2((middle<<16u)|(low&65535u),a1*b1+(t>>16u)+(middle>>16u));
}
uvec4 product64(uvec2 a,uvec2 b) {
  // Four 32x32 products with explicit carries; no dynamic local arrays.
  uvec2 p=product32(a.x,b.x),q=product32(a.x,b.y),r=product32(a.y,b.x),s=product32(a.y,b.y);
  uint y0=p.y+q.x,c0=uint(y0<p.y),y=y0+r.x,c1=uint(y<y0);
  uvec2 high=uadd(uadd(uadd(s,uvec2(q.y,0u)),uvec2(r.y,0u)),uvec2(c0+c1,0u));
  return uvec4(p.x,y,high);
}
uvec2 dmul(uvec2 a,uvec2 b) {
  bool s=ds(a)!=ds(b);
  if(dn(a)||dn(b)||(di(a)&&dz(b))||(di(b)&&dz(a)))return nan64();
  if(di(a)||di(b))return inf64(s);
  if(dz(a)||dz(b))return uvec2(0u,s?0x80000000u:0u);
  Parts x=unpack64(a),y=unpack64(b);uvec4 p=product64(x.m,y.m);
  uvec2 m=uvec2((p.y>>17u)|(p.z<<15u),(p.z>>17u)|(p.w<<15u));
  m.x|=uint(p.x!=0u || (p.y&131071u)!=0u);
  return pack64(s,x.e+y.e,m);
}
uvec2 ddiv(uvec2 a,uvec2 b) {
  bool s=ds(a)!=ds(b);
  if(dn(a)||dn(b)||(dz(a)&&dz(b))||(di(a)&&di(b)))return nan64();
  if(di(a)||dz(b))return inf64(s);
  if(dz(a)||di(b))return uvec2(0u,s?0x80000000u:0u);
  Parts x=unpack64(a),y=unpack64(b);int e=x.e-y.e;
  uvec2 r=x.m;if(ult(r,y.m)){r=ul(r,1);e--;}
  r=usub(r,y.m);uvec2 q=uvec2(1u,0u);
  for(int i=0;i<u_arithmeticLoops.x;i++){r=ul(r,1);q=ul(q,1);if(!ult(r,y.m)){r=usub(r,y.m);q.x|=1u;}}
  q.x|=uint(!uzero(r));return pack64(s,e,q);
}
bool deq(uvec2 a,uvec2 b) { return !dn(a)&&!dn(b)&&(all(equal(a,b))||(dz(a)&&dz(b))); }
bool dlt(uvec2 a,uvec2 b) {
  if(dn(a)||dn(b)||deq(a,b))return false;
  if(ds(a)!=ds(b))return ds(a);return ds(a)?ult(da(b),da(a)):ult(a,b);
}
bool dle(uvec2 a,uvec2 b) { return deq(a,b)||dlt(a,b); }
uvec2 df(float f) {
  uint a=floatBitsToUint(f),s=a&0x80000000u,exp=(a>>23u)&255u,m=a&0x7fffffu;
  if(exp==255u)return m!=0u?nan64():uvec2(0u,s|0x7ff00000u);
  if(exp==0u){if(m==0u)return uvec2(0u,s);return pack64(s!=0u,-97,ul(uvec2(m,0u),3));}
  return uvec2(m<<29u,s|((exp+896u)<<20u)|(m>>3u));
}
float toFloat(uvec2 a) {
  if(dn(a))return uintBitsToFloat(0x7fc00000u);if(di(a))return uintBitsToFloat(ds(a)?0xff800000u:0x7f800000u);
  if(dz(a))return ds(a)?-0.:0.;
  Parts p=unpack64(a);
  float v=(float(p.m.y)*4294967296.+float(p.m.x))*exp2(float(p.e-52));
  // Avoid flushing a valid small normal before multiplying by its significand.
  if(p.e < -74)v=(float(p.m.y)/1048576.+float(p.m.x)/4503599627370496.)*exp2(float(p.e));
  return p.s?-v:v;
}
`;

/** Preserve the original source as a separately selectable numerical reference. */
export function binary64Source(variant:KernelVariant='reference') {
  const features=kernelFeatures(variant);let source=binary64GLSL;
  if(features.estimatedDivision){
    const begin=source.indexOf('uvec2 ddiv('),end=source.indexOf('bool deq(');
    source=source.slice(0,begin)+estimatedDivisionGLSL+source.slice(end);
  }
  if(features.fast){
    source=source.replace('Parts x=unpack64(a),y=unpack64(b);uvec4 p=product64(x.m,y.m);',`Parts x=unpack64(a),y=unpack64(b);
  if(all(equal(x.m,uvec2(0u,0x100000u))))return pack64(s,x.e+y.e,ul(y.m,3));
  if(all(equal(y.m,uvec2(0u,0x100000u))))return pack64(s,x.e+y.e,ul(x.m,3));
  uvec4 p=product64(x.m,y.m);`);
    source=source.replace('Parts x=unpack64(a),y=unpack64(b);int e=x.e-y.e;',`Parts x=unpack64(a),y=unpack64(b);int e=x.e-y.e;
  if(all(equal(x.m,y.m)))return pack64(s,e,uvec2(0u,0x800000u));
  if(all(equal(y.m,uvec2(0u,0x100000u))))return pack64(s,e,ul(x.m,3));`);
  }
  if(features.radix4)source=source.replace(
    'for(int i=0;i<u_arithmeticLoops.x;i++){r=ul(r,1);q=ul(q,1);if(!ult(r,y.m)){r=usub(r,y.m);q.x|=1u;}}',
    `uvec2 twice=ul(y.m,1),thrice=uadd(twice,y.m);
  for(int i=0;i<u_arithmeticLoops.x/2;i++){
    r=ul(r,2);q=ul(q,2);uint digit=0u;
    if(!ult(r,twice)){if(!ult(r,thrice)){r=usub(r,thrice);digit=3u;}else{r=usub(r,twice);digit=2u;}}
    else if(!ult(r,y.m)){r=usub(r,y.m);digit=1u;}q.x|=digit;
  }
  if((u_arithmeticLoops.x&1)!=0){r=ul(r,1);q=ul(q,1);if(!ult(r,y.m)){r=usub(r,y.m);q.x|=1u;}}`);
  if(features.reciprocal)source+=complexInverseGLSL;
  return source;
}

/** Normal-range complex reciprocal. A rejected input resumes the old bytecode
 * path; the large legacy division expression is not duplicated in this shader.
 * Integer exponent adjustment is exact within the guarded normal range. */
export const complexInverseGLSL = `
uvec2 dscaleNormal(uvec2 a,int shift){Parts p=unpack64(a);return pack64(p.s,p.e+shift,ul(p.m,3));}
bool cInverseFast(uvec2 x,uvec2 y,out uvec2 real,out uvec2 imag){
  real=uvec2(0u);imag=uvec2(0u);
  if(dn(x)||dn(y)||di(x)||di(y)||dz(x)||dz(y))return false;
  Parts a=unpack64(x),b=unpack64(y);int exponent=max(a.e,b.e);
  if(exponent < -450 || exponent > 450 || min(a.e,b.e)-exponent < -450)return false;
  uvec2 sx=dscaleNormal(x,-exponent),sy=dscaleNormal(y,-exponent);
  uvec2 denominator=dadd(dmul(sx,sx),dmul(sy,sy));
  uvec2 inverse=ddiv(uvec2(0u,0x3ff00000u),denominator);
  real=dscaleNormal(dmul(sx,inverse),-exponent);
  imag=dscaleNormal(neg(dmul(sy,inverse)),-exponent);
  return !dn(real)&&!dn(imag)&&!di(real)&&!di(imag);
}
`;
