import type { SceneState } from '../../domain/types';
import { unitRoots } from '../../domain/roots';
import { hexRgb, palettes } from '../../domain/palettes';
import type { Program } from './programs';
import type { WebGLResources } from './resources';
import type { preciseProgram } from '../preciseProgram';
type Uniform = (program: Program,name: string) => WebGLUniformLocation | null;
export function fieldProjection(gl:WebGL2RenderingContext,program:Program,uniform:Uniform,resources:WebGLResources,scene:SceneState,fieldScene:SceneState,width:number,height:number) {
    const source=fieldScene.camera,current=scene.camera,size=resources.frontSize;
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,resources.texture);gl.uniform1i(uniform(program,'u_data'),0);
    gl.uniform2f(uniform(program,'u_view'),width,height);gl.uniform2f(uniform(program,'u_extent'),size.width,size.height);
    gl.uniform3f(uniform(program,'u_projection'),(current.x-source.x)/source.height*size.height+size.width/2,(current.y-source.y)/source.height*size.height+size.height/2,current.height/height/source.height*size.height);
}
export function floatField(gl:WebGL2RenderingContext,program:Program,uniform:Uniform,framebuffer:WebGLFramebuffer|null,width:number,height:number,scene:SceneState) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.useProgram(program.handle);
      gl.uniform2f(uniform(program, 'u_resolution'), width, height);
      gl.uniform2f(uniform(program, 'u_center'), scene.camera.x, scene.camera.y);
      gl.uniform1f(uniform(program, 'u_height'), scene.camera.height);
      gl.uniform1i(uniform(program, 'u_iterations'), scene.iterations);
      gl.uniform2f(uniform(program, 'u_julia'), scene.parameters.juliaRe, scene.parameters.juliaIm);
      gl.uniform1i(uniform(program, 'u_power'), scene.parameters.power);
      if (scene.fractalId === 'newton') gl.uniform2fv(uniform(program, 'u_roots[0]'), unitRoots(scene.parameters.power));
      gl.uniform1f(uniform(program, 'u_relaxation'), scene.parameters.novaRelaxation ?? 1);
      gl.uniform2f(uniform(program, 'u_phoenix'), scene.parameters.phoenixRe ?? .56667, scene.parameters.phoenixIm ?? 0);
      gl.uniform1f(uniform(program, 'u_memory'), scene.parameters.phoenixMemory ?? -.5);
        gl.drawArrays(gl.TRIANGLES,0,3);
}
export function colorField(gl:WebGL2RenderingContext,color:Program,uniform:Uniform,resources:WebGLResources,scene:SceneState,fieldScene:SceneState,width:number,height:number) {
    gl.bindVertexArray(resources.vao); gl.viewport(0, 0, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(color.handle);
    fieldProjection(gl,color,uniform,resources,scene,fieldScene,width,height);
    gl.uniform1i(uniform(color, 'u_mode'), fieldScene.fractalId === 'newton' ? 1 : fieldScene.fractalId === 'magnet-1' ? 2 : 0);
    gl.uniform1i(uniform(color, 'u_degree'), fieldScene.parameters.power);
    const palette = palettes.find(p => p.id === scene.coloring.palette) ?? palettes[0];
    gl.uniform3fv(uniform(color, 'u_colors[0]'), palette.colors.flatMap(hexRgb));
    gl.uniform3fv(uniform(color, 'u_interior'), hexRgb(scene.coloring.interior));
    gl.uniform1f(uniform(color, 'u_phase'), scene.coloring.phase); gl.uniform1f(uniform(color, 'u_density'), scene.coloring.density);
}
export function bindBinary64(gl:WebGL2RenderingContext,program:Program,uniform:Uniform,resources:WebGLResources,snapshot:SceneState,width:number,height:number,instructions:ReturnType<typeof preciseProgram>) {
      gl.uniform2i(uniform(program, 'u_arithmeticLoops'), 55, 4);
      gl.uniform2f(uniform(program, 'u_resolution'), width, height);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,resources.instructionTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32UI,instructions.width,2,0,gl.RGBA_INTEGER,gl.UNSIGNED_INT,instructions.data);
      gl.uniform1i(uniform(program,'u_program'),1);
      gl.uniform1i(uniform(program,'u_registerCount'),instructions.registers);
      gl.uniform1i(uniform(program,'u_steps'),instructions.length*(snapshot.iterations+2)+32);
      gl.uniform2iv(uniform(program,'u_offset'),instructions.offset);
      gl.uniform4iv(uniform(program,'u_output'),instructions.output);
      gl.uniform1i(uniform(program,'u_root'),instructions.root);
      gl.uniform1i(uniform(program,'u_kind'),instructions.kind);
      gl.uniform1i(uniform(program,'u_legacy'),Number(instructions.legacy));
      gl.uniform1i(uniform(program, 'u_power'), snapshot.parameters.power); gl.uniform1i(uniform(program, 'u_iterations'), snapshot.iterations);
  resources.instructionBytes=instructions.data.byteLength;
}
