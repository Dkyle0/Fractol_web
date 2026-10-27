import {describe,it,expect,vi} from 'vitest';
import {createScene,fractals} from '../../src/domain/catalog';
import {fieldTiles} from '../../src/domain/fieldTiles';
import {computeViewingPlan} from '../../src/domain/viewing';
import {doubleSingleProgram,doubleSingleShader} from '../../src/rendering/doubleSingleShader';
import {splitDouble} from '../../src/rendering/doubleSingle';
import {precisionSliceShader} from '../../src/rendering/precisionOrbitSlices';
import {probeDoubleSingle} from '../../src/rendering/doubleSingleProbe';
import {probeBinary64} from '../../src/rendering/binary64Probe';
import {flatPreview} from '../../src/rendering/webgl/flatPreview';
import {orbitSlicedField,type OrbitContext} from '../../src/rendering/webgl/orbitSlicedField';
describe('extended preview and progressive fields',()=>{
 it.each(['flat','sliced'])('cancels %s preparation without waiting for the shared shader compilation',async mode=>{
  let reject!: (reason:Error)=>void;
  const compilation=new Promise<never>((_,fail)=>{reject=fail;}),allocate=vi.fn(),createQuery=vi.fn();
  const context={gl:{createQuery},resources:{allocate},programs:{doubleSingle:()=>compilation},stats:{},ensureActive:()=>{}} as unknown as OrbitContext;
  const abort=new AbortController(),scene=createScene();
  const run=mode==='flat'?flatPreview(context,scene,1,1,abort.signal):orbitSlicedField(context,scene,1,1,abort.signal,()=>{},undefined,{arithmetic:'double-single'});
  abort.abort(new Error('cancelled preparation'));await expect(run).rejects.toThrow('cancelled preparation');
  expect(allocate).not.toHaveBeenCalled();expect(createQuery).not.toHaveBeenCalled();
  reject(new Error('late compiler failure'));await Promise.resolve();
 });
 it('releases partial arithmetic-probe allocations when a resource cannot be created',async()=>{
  const framebuffer={},vao={},present=vi.fn(),gl={createFramebuffer:()=>framebuffer,createTexture:()=>null,createVertexArray:()=>vao,isContextLost:()=>false,bindFramebuffer:vi.fn(),deleteFramebuffer:vi.fn(),deleteTexture:vi.fn(),deleteVertexArray:vi.fn()};
  await expect(probeDoubleSingle(gl as unknown as WebGL2RenderingContext,{} as WebGLProgram,present)).rejects.toThrow();
  expect(gl.deleteFramebuffer).toHaveBeenCalledWith(framebuffer);expect(gl.deleteVertexArray).toHaveBeenCalledWith(vao);expect(present).toHaveBeenCalledOnce();
 });
 it('releases partial exact-probe allocations when its second texture fails',async()=>{
  const input={},framebuffer={},vao={},gl={createTexture:vi.fn().mockReturnValueOnce(input).mockReturnValueOnce(null),createFramebuffer:()=>framebuffer,createVertexArray:()=>vao,isContextLost:()=>false,bindFramebuffer:vi.fn(),deleteFramebuffer:vi.fn(),deleteTexture:vi.fn(),deleteVertexArray:vi.fn()};
  await expect(probeBinary64(gl as unknown as WebGL2RenderingContext,{} as WebGLProgram,[[1,2]])).rejects.toThrow();
  expect(gl.deleteFramebuffer).toHaveBeenCalledWith(framebuffer);expect(gl.deleteTexture).toHaveBeenCalledWith(input);expect(gl.deleteVertexArray).toHaveBeenCalledWith(vao);
 });
 it('keeps all camera bits out of shader specialization',()=>{
  for(const f of fractals){const scene=createScene(f.id),a=doubleSingleProgram(scene,1920,1080);scene.camera={x:0,y:1,height:.001};scene.parameters.juliaRe=0;scene.parameters.novaRelaxation=.1;scene.parameters.phoenixRe=0;scene.parameters.phoenixMemory=0;
   const b=doubleSingleProgram(scene,640,480);expect(a.key,f.id).toBe(b.key);expect(a.initial).not.toEqual(b.initial);
   expect(doubleSingleShader(a)).toContain('stateMeta');expect(doubleSingleShader(a,true)).toContain('out vec4 result');
  }
 });
 it('plans only bounded float32 or double-single viewing arithmetic',()=>{
  const view={width:1920,height:1080},camera={x:-.7,y:.1,height:.00001},scene=createScene();scene.camera=camera;
  scene.iterations=3584;
  expect(computeViewingPlan(scene,view,1).arithmetic).toBe('double-single');
  expect(computeViewingPlan(scene,view,1,{unavailable:'probe failed'}).arithmetic).toBe('float32');
  expect(computeViewingPlan(scene,view,1,{unavailable:'probe failed'}).effectiveIterations).toBe(2000);
  scene.camera={...scene.camera,height:1e-12};
  expect(computeViewingPlan(scene,view,1).overview).toBe(true);
  const a=splitDouble(camera.x),b=splitDouble(camera.x+camera.height/view.height);
  expect(a[0]).toBe(b[0]);expect(a[1]).not.toBe(b[1]);
 });
 it('covers edge tiles exactly once in deterministic center-out order',()=>{
  const tiles=fieldTiles(273,145),counts=new Uint8Array(273*145);
  expect(tiles[0]).toEqual({x:128,y:0,width:128,height:128});
  for(const t of tiles)for(let y=t.y;y<t.y+t.height;y++)for(let x=t.x;x<t.x+t.width;x++)counts[y*273+x]!++;
  expect(counts.every(n=>n===1)).toBe(true);expect(tiles).toEqual(fieldTiles(273,145));
 });
 it('bounds register specializations without touching arithmetic',()=>{
  for(const capacity of [32,48,64,128])expect(precisionSliceShader(capacity)).toContain(`r[${capacity}]`);
  expect(()=>precisionSliceShader(16)).toThrow();
 });
});
