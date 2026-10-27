import type { FractalDefinition } from '../domain/types';
import { convergenceShader } from './convergenceShader';

export const vertexShader = `#version 300 es
precision highp float;
const vec2 positions[3] = vec2[3](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.));
void main() { gl_Position = vec4(positions[gl_VertexID], 0., 1.); }
`;

export function computationShader(definition: FractalDefinition) {
  const kind = definition.shaderKind;
  if (['newton', 'nova', 'phoenix', 'magnet-1'].includes(definition.id)) return convergenceShader(kind);
  return `#version 300 es
precision highp float;
precision highp int;
#define KIND ${kind}
#define LEGACY ${definition.resultKind === 'legacy-escape' ? 1 : 0}
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_height;
uniform int u_iterations;
uniform vec2 u_julia;
uniform int u_power;
out vec4 result;
vec2 multiply(vec2 a, vec2 b) { return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
void main() {
  vec2 point = u_center + (gl_FragCoord.xy - u_resolution * .5) * u_height / u_resolution.y;
  vec2 z = vec2(0.);
  vec2 c = point;
  #if KIND == 1
    z = point; c = u_julia;
  #elif LEGACY
    z = point;
  #endif
  float limit = 4.;
  #if KIND == 9
    limit = 16.;
  #elif KIND == 1
    limit = max(4., dot(c,c) + 2.);
  #endif
  int n = 0;
  bool escaped = false;
  for (int i = 0; i < 16384; i++) {
    if (i >= u_iterations) break;
    #if KIND == 8
      bool outside = dot(z,z) >= limit;
    #else
      bool outside = dot(z,z) > limit;
    #endif
    if (outside) { escaped = true; break; }
    vec2 square = multiply(z,z);
    #if KIND == 2
      z = vec2(square.x, abs(square.y)) + c;
    #elif KIND == 3
      z = vec2(square.x, -square.y) + c;
    #elif KIND == 4
      vec2 powered = vec2(1., 0.);
      for (int p = 0; p < 8; p++) { if (p >= u_power) break; powered = multiply(powered, z); }
      z = powered + c;
    #elif KIND == 5
      z = vec2(abs(square.x), square.y) + c;
    #elif KIND == 6
      z = abs(square) + c;
    #elif KIND == 7
      z = vec2(square.x, -2. * abs(z.x) * z.y) + c;
    #elif KIND == 8
      z = vec2(abs(square.x + c.x), abs(square.y) + c.y);
    #elif KIND == 9
      z.x = square.x + c.x;
      z.y = 2. * z.x * z.y + c.y;
      c = c * .5 + z;
    #else
      z = square + c;
    #endif
    n++;
  }
  float value = float(n);
  #if !LEGACY
    float degree = 2.;
    #if KIND == 4
      degree = float(u_power);
    #endif
    if (escaped) value = max(0., float(n) + 1. - log(log(max(1.00001, length(z)))) / log(degree));
  #endif
  // 24-bit fixed point (1/256 iteration), alpha stores membership independently.
  uint packed = uint(clamp(value * 256., 0., 16777215.));
  result = vec4(float((packed >> 16u) & 255u), float((packed >> 8u) & 255u), float(packed & 255u), escaped ? 255. : 0.) / 255.;
}
`; }

export const coloringShader = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_data;
uniform vec3 u_colors[6];
uniform vec3 u_interior;
uniform float u_phase;
uniform float u_density;
uniform int u_mode;
uniform int u_degree;
uniform vec2 u_view;
uniform vec2 u_extent;
uniform vec3 u_projection;
out vec4 result;
void main() {
  vec2 source = u_projection.xy + (gl_FragCoord.xy-u_view*.5)*u_projection.z;
  if(any(lessThan(source,vec2(0.)))||any(greaterThanEqual(source,u_extent))){float hatch=mod(floor(gl_FragCoord.x/12.)+floor(gl_FragCoord.y/12.),2.);result=vec4(mix(vec3(.055,.085,.10),vec3(.075,.11,.125),hatch),1.);return;}
  vec4 packed = texelFetch(u_data, ivec2(source), 0);
  int code = int(floor(packed.a * 255. + .5));
  if(code==254){float hatch=mod(floor(gl_FragCoord.x/12.)+floor(gl_FragCoord.y/12.),2.);result=vec4(mix(vec3(.055,.085,.10),vec3(.075,.11,.125),hatch),1.);return;}
  bool colored = code == 255 || code == 3 || code == 4 || (code >= 16 && code <= 23);
  if (!colored) { result = vec4(u_interior, 1.); return; }
  vec3 bytes = floor(packed.rgb * 255. + .5);
  float value = dot(bytes, vec3(65536., 256., 1.)) / 256.;
  float cycle = sqrt(max(value, 0.)) * .085 * u_density;
  if (u_mode == 1) cycle = float(code - 16) / float(u_degree) * u_density;
  if (u_mode == 2 && code == 3) cycle += .5;
  float position = fract(cycle + u_phase) * 6.;
  int index = int(floor(position));
  float blend = smoothstep(0., 1., fract(position));
  vec3 color = mix(u_colors[index], u_colors[(index + 1) % 6], blend);
  if (u_mode == 1) color *= .3 + .7 / (1. + .045 * value);
  result = vec4(color, 1.);
}
`;

/** Raw field reprojection for seeding a new-resolution refinement. No palette. */
export const fieldProjectionShader=`#version 300 es
precision highp float;precision highp int;
uniform sampler2D u_data;uniform vec2 u_view,u_extent;uniform vec3 u_projection;
out vec4 result;
void main(){vec2 source=u_projection.xy+(gl_FragCoord.xy-u_view*.5)*u_projection.z;
 if(any(lessThan(source,vec2(0.)))||any(greaterThanEqual(source,u_extent)))result=vec4(0.,0.,0.,254./255.);
 else result=texelFetch(u_data,ivec2(source),0);
}`;
