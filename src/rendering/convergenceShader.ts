/** Formula v1 kernels. Kept separate from the unchanged legacy escape kernels. */
export function convergenceShader(kind: number) { return `#version 300 es
precision highp float;
precision highp int;
#define KIND ${kind}
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_height;
uniform int u_iterations;
uniform int u_power;
uniform vec2 u_roots[8];
uniform float u_relaxation;
uniform vec2 u_phoenix;
uniform float u_memory;
out vec4 result;
const float threshold = 1e-5;
vec2 mul(vec2 a, vec2 b) { return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
bool invalid(vec2 z) { return any(isnan(z)) || any(isinf(z)); }
float norm(vec2 z) { float s = max(abs(z.x), abs(z.y)); return s == 0. ? 0. : s * length(z / s); }
vec2 divide(vec2 a, vec2 b) {
  float s = max(abs(b.x), abs(b.y));
  vec2 d = b / s, scaled = a / s;
  return vec2(dot(scaled, d), scaled.y*d.x-scaled.x*d.y) / dot(d,d);
}
vec2 power(vec2 z, int degree) { vec2 v = vec2(1.,0.); for (int j=0;j<8;j++) { if (j>=degree) break; v=mul(v,z); } return v; }
float residual(vec2 z) { return norm(z) > 2. ? 1e20 : norm(power(z,u_power)-vec2(1.,0.)); }
float crossing(int n, float before, float after) {
  if (!(before > threshold && after > 0. && after < before) || isinf(before) || isnan(before)) return float(n);
  float fraction = log(before / threshold) / log(before / after);
  return isnan(fraction) || isinf(fraction) ? float(n) : float(n-1) + clamp(fraction,0.,1.);
}
void main() {
  vec2 point = u_center + (gl_FragCoord.xy-u_resolution*.5)*u_height/u_resolution.y;
  vec2 z, c = point, previous = vec2(0.);
  float error = 1e30;
  #if KIND == 10
    z=point; error=residual(z);
  #elif KIND == 11
    z=vec2(1.,0.);
  #elif KIND == 12
    z=point; c=u_phoenix;
  #else
    z=vec2(0.); error=1.;
  #endif
  int code=0;
  float value=float(u_iterations);
  #if KIND == 10
    if (error <= threshold) { code=3; value=0.; }
  #endif
  for (int i=0;i<16384;i++) {
    if (i>=u_iterations || code!=0) break;
    vec2 old=z;
    float before=error;
    #if KIND == 10 || KIND == 11
      if (all(equal(z,vec2(0.)))) { code=1; value=float(i); break; }
      // Algebraically equivalent Newton step via 1/z; avoids overflow of z^p.
      vec2 inverse=divide(vec2(1.,0.),z);
      #if KIND == 10
        float degree=float(u_power);
        z=(1.-1./degree)*z+power(inverse,u_power-1)/degree;
        error=residual(z);
      #else
        z=(1.-u_relaxation/3.)*z+(u_relaxation/3.)*mul(inverse,inverse)+c;
        error=norm(z-old);
      #endif
    #elif KIND == 12
      z=mul(z,z)+c+u_memory*previous;
      previous=old;
    #else
      vec2 denominator=2.*z+c-vec2(2.,0.);
      if (all(equal(denominator,vec2(0.)))) { code=1; value=float(i); break; }
      vec2 quotient=divide(mul(z,z)+c-vec2(1.,0.),denominator);
      z=mul(quotient,quotient); error=norm(z-vec2(1.,0.));
    #endif
    if (invalid(z) || isnan(error)) { code=2; value=float(i+1); break; }
    #if KIND != 12
      if (error <= threshold) { code=3; value=crossing(i+1,before,error); break; }
    #endif
    #if KIND == 12 || KIND == 13
      float radius=norm(z);
      float bailout= ${kind === 12 ? '16.' : '100.'};
      if (radius>bailout) { code=4; value=max(0.,float(i+2)-log(log(radius))/log(2.)); break; }
    #endif
  }
  #if KIND == 10
    if (code==3) {
      float best=1e30; int root=0;
      for (int j=0;j<8;j++) { if (j>=u_power) break; float d=length(z-u_roots[j]); if (d<best) { best=d; root=j; } }
      code=16+root;
    }
  #endif
  uint packed=uint(clamp(value*256.,0.,16777215.));
  result=vec4(float((packed>>16u)&255u),float((packed>>8u)&255u),float(packed&255u),float(code))/255.;
}
`; }
