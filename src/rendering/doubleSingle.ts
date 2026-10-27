/** Approximate extended-precision preview. Never an IEEE binary64 replacement. */
export const DOUBLE_SINGLE_VERSION='double-single-preview-v1';
export function splitDouble(value:number):[number,number] {
 const high=Math.fround(value);
 return [high,Number.isFinite(high)?Math.fround(value-high):0];
}
export const doubleSingleGLSL=`
uniform float u_one,u_split;
bool ds_invalid=false;
vec2 ds_norm(float a,float b){float s=a+b;if(isinf(s)||isnan(s)||(s!=0.&&(abs(s)<1e-30||abs(s)>1e30)))ds_invalid=true;return vec2(s,b-(s-a)*u_one);}
vec2 ds_add(vec2 a,vec2 b){
 if(isinf(a.x)||isinf(b.x)||isnan(a.x)||isnan(b.x))return vec2(a.x+b.x,0.);
 float s=a.x+b.x,v=(s-a.x)*u_one;
 float e=((a.x-(s-v)*u_one)*u_one+(b.x-v)*u_one)*u_one+a.y+b.y;
 return ds_norm(s,e);
}
vec2 ds_neg(vec2 a){return -a;}
vec2 ds_sub(vec2 a,vec2 b){return ds_add(a,-b);}
vec2 ds_abs(vec2 a){return a.x<0.||(a.x==0.&&a.y<0.)?-a:a;}
vec2 ds_mul(vec2 a,vec2 b){
 if(isinf(a.x)||isinf(b.x)||isnan(a.x)||isnan(b.x))return vec2(a.x*b.x,0.);
 float ca=u_split*a.x,cb=u_split*b.x;
 float ah=(ca-(ca-a.x)*u_one)*u_one,al=(a.x-ah)*u_one;
 float bh=(cb-(cb-b.x)*u_one)*u_one,bl=(b.x-bh)*u_one;
 float p=a.x*b.x;
 if(p==0.&&a.x!=0.&&b.x!=0.)ds_invalid=true;
 float e=(((ah*bh-p)*u_one+ah*bl)*u_one+al*bh)*u_one+al*bl;
 e=(e+a.x*b.y)*u_one+a.y*b.x;
 return ds_norm(p,e);
}
vec2 ds_div(vec2 a,vec2 b){
 float q=a.x/b.x;
 if(isinf(q)||isnan(q))return vec2(q,0.);
 vec2 r=ds_sub(a,ds_mul(b,vec2(q,0.)));
 return ds_norm(q,(r.x+r.y)/b.x);
}
bool ds_zero(vec2 a){return a.x==0.&&a.y==0.;}
bool ds_bad(vec2 a){return any(isnan(a))||any(isinf(a));}
bool ds_lt(vec2 a,vec2 b){return a.x<b.x||(a.x==b.x&&a.y<b.y);}
bool ds_le(vec2 a,vec2 b){return !any(isnan(a))&&!any(isnan(b))&&(a.x<b.x||(a.x==b.x&&a.y<=b.y));}
float ds_ln(vec2 a){a=ds_abs(a);return log(a.x)+log(1.+a.y/a.x);}
float ds_radius(vec2 x,vec2 y){float a=abs(x.x),b=abs(y.x),s=max(a,b);return log(s)+.5*log((a/s)*(a/s)+(b/s)*(b/s));}
`;
