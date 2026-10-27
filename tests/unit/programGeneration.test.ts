import {describe,it,expect,vi} from 'vitest';
import {WebGLPrograms} from '../../src/rendering/webgl/programs';
import {RenderCancelledError} from '../../src/rendering/backend';

describe('GPU program context generation',()=>{
 it('never queries or deletes handles from the previous generation after a delayed compile',async()=>{
  let generation=0,obsoleteCalls=0;
  const touch=()=>{if(generation!==0)obsoleteCalls++;};
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,LINK_STATUS:3,
   getExtension:()=>({COMPLETION_STATUS_KHR:4}),createProgram:()=>({}),createShader:()=>({}),shaderSource:vi.fn(),compileShader:vi.fn(),attachShader:vi.fn(),linkProgram:vi.fn(),isContextLost:()=>false,
   getProgramParameter:()=>{touch();return false;},isProgram:vi.fn(()=>{touch();return true;}),isShader:vi.fn(()=>{touch();return true;}),deleteProgram:vi.fn(touch),deleteShader:vi.fn(touch),getShaderInfoLog:()=>'',getProgramInfoLog:()=>'',
  };
  const programs=new WebGLPrograms(gl as unknown as WebGL2RenderingContext,()=>generation,expected=>{if(expected!==generation)throw new RenderCancelledError();});
  programs.delay=async()=>{generation++;};
  await expect(programs.cached('test',()=>'' )).rejects.toBeInstanceOf(RenderCancelledError);
  expect(obsoleteCalls).toBe(0);expect(gl.deleteProgram).not.toHaveBeenCalled();expect(gl.deleteShader).not.toHaveBeenCalled();
  expect(gl.isProgram).not.toHaveBeenCalled();expect(gl.isShader).not.toHaveBeenCalled();
 });
 it('still releases failed programs and shaders in the active generation',async()=>{
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,LINK_STATUS:3,
   getExtension:()=>null,createProgram:()=>({}),createShader:()=>({}),shaderSource:vi.fn(),compileShader:vi.fn(),attachShader:vi.fn(),linkProgram:vi.fn(),isContextLost:()=>false,
   getProgramParameter:()=>false,isProgram:vi.fn(()=>true),isShader:vi.fn(()=>true),deleteProgram:vi.fn(),deleteShader:vi.fn(),getShaderInfoLog:()=>'',getProgramInfoLog:()=>'',
  };
  const programs=new WebGLPrograms(gl as unknown as WebGL2RenderingContext,()=>0,()=>{});
  await expect(programs.cached('test',()=>'' )).rejects.toThrow();
  expect(gl.deleteProgram).toHaveBeenCalledOnce();expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  expect(gl.isProgram).not.toHaveBeenCalled();expect(gl.isShader).not.toHaveBeenCalled();
 });
 it('releases a cancelled compile when the context is still owned after disposal',async()=>{
  let disposed=false,done!:()=>void;
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,LINK_STATUS:3,
   getExtension:()=>({COMPLETION_STATUS_KHR:4}),createProgram:()=>({}),createShader:()=>({}),shaderSource:vi.fn(),compileShader:vi.fn(),attachShader:vi.fn(),linkProgram:vi.fn(),isContextLost:()=>false,
   getProgramParameter:()=>false,isProgram:vi.fn(()=>true),isShader:vi.fn(()=>true),deleteProgram:vi.fn(),deleteShader:vi.fn(),getShaderInfoLog:()=>'',getProgramInfoLog:()=>'',
  };
  const programs=new WebGLPrograms(gl as unknown as WebGL2RenderingContext,()=>0,()=>{if(disposed)throw new RenderCancelledError();});
  programs.delay=()=>new Promise(resolve=>{done=resolve;});const pending=programs.cached('test',()=>'' );
  disposed=true;programs.dispose();done();await expect(pending).rejects.toBeInstanceOf(RenderCancelledError);
  expect(gl.deleteProgram).toHaveBeenCalledOnce();expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  expect(gl.isProgram).not.toHaveBeenCalled();expect(gl.isShader).not.toHaveBeenCalled();
 });
 it('releases successfully compiled owned handles without synchronous existence queries',async()=>{
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,LINK_STATUS:3,
   getExtension:()=>null,createProgram:()=>({}),createShader:()=>({}),shaderSource:vi.fn(),compileShader:vi.fn(),attachShader:vi.fn(),linkProgram:vi.fn(),isContextLost:()=>false,
   getProgramParameter:()=>true,isProgram:vi.fn(()=>true),isShader:vi.fn(()=>true),deleteProgram:vi.fn(),deleteShader:vi.fn(),
  };
  const programs=new WebGLPrograms(gl as unknown as WebGL2RenderingContext,()=>0,()=>{});
  await programs.cached('test',()=>'' );
  expect(gl.deleteShader).toHaveBeenCalledTimes(2);expect(gl.deleteProgram).not.toHaveBeenCalled();
  programs.dispose();expect(gl.deleteProgram).toHaveBeenCalledOnce();
  expect(gl.isProgram).not.toHaveBeenCalled();expect(gl.isShader).not.toHaveBeenCalled();
 });
});
