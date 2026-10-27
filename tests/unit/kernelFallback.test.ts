import {describe,it,expect,vi} from 'vitest';
import {WebGLPrograms} from '../../src/rendering/webgl/programs';
import {RenderCancelledError} from '../../src/rendering/backend';
import {precisionSliceShader} from '../../src/rendering/precisionOrbitSlices';
import * as kernels from '../../src/rendering/kernel';
import {createScene} from '../../src/domain/catalog';

function setup(){
 const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,LINK_STATUS:3,getExtension:()=>null,isContextLost:()=>false,
  createProgram:()=>({}),createShader:()=>({}),shaderSource:vi.fn(),compileShader:vi.fn(),attachShader:vi.fn(),linkProgram:vi.fn(),getProgramParameter:()=>true,getShaderInfoLog:()=> 'injected link failure',getProgramInfoLog:()=> 'injected link failure',deleteProgram:vi.fn(),deleteShader:vi.fn()};
 let generation=0;const programs=new WebGLPrograms(gl as unknown as WebGL2RenderingContext,()=>generation,expected=>{if(expected!==undefined&&expected!==generation)throw new RenderCancelledError();});
 programs.setKernelVariant('fast');
 return {programs,gl,nextGeneration:()=>{generation++;}};
}
describe('candidate kernel self-test fallback',()=>{
 it('allows an existing DS specialization that becomes ready at45s without extending ordinary candidate compilation',async()=>{
  const {programs,gl}=setup();let elapsed=0;
  const clock=vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
  programs.parallel={COMPLETION_STATUS_KHR:4};programs.delay=async()=>{elapsed+=5000;};
  vi.spyOn(gl,'getProgramParameter').mockImplementation((_handle?:unknown,parameter?:number)=>parameter===4?elapsed>=45000:true);
  vi.spyOn(programs,'verifyDoubleSingle').mockResolvedValue(undefined);
  try{
   const scene=createScene('newton');scene.parameters.power=8;
   const prepared=await programs.doubleSingle(scene,1,1,true);expect(prepared.program.handle).toBeTruthy();expect(elapsed).toBe(45000);
  }finally{programs.dispose();clock.mockRestore();}
 });
 it('still rejects an ordinary candidate compile after30s while the same driver is not ready until45s',async()=>{
  const {programs,gl}=setup();let elapsed=0;
  const clock=vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
  programs.parallel={COMPLETION_STATUS_KHR:4};programs.delay=async()=>{elapsed+=5000;};
  vi.spyOn(gl,'getProgramParameter').mockImplementation((_handle?:unknown,parameter?:number)=>parameter===4?elapsed>=45000:true);
  try{await expect(programs.cached('@binary64:candidate',()=>precisionSliceShader(128,'fast'))).rejects.toThrow('30 секунд');expect(elapsed).toBe(35000);}
  finally{programs.dispose();clock.mockRestore();}
 });
 it('prepares only reference code when the selected candidate self-test fails',async()=>{
  const {programs,gl}=setup();const verify=vi.spyOn(programs,'verifyArithmetic').mockImplementation(async(_pairs,kernel)=>kernel==='reference'?[]:['injected candidate failure']);
  await programs.prepare('nova','binary64');
  expect(verify.mock.calls.map(call=>call[1])).toEqual(['fast','reference']);expect(programs.kernel).toBe('reference');
  expect(programs.kernelFailure).toContain('injected candidate failure');expect(programs.programs.has(programs.precisionKey)).toBe(true);
  await programs.prepare('nova','binary64');expect(verify.mock.calls.map(call=>call[1])).toEqual(['fast','reference']);
  const sources=gl.shaderSource.mock.calls.map(call=>call[1]);expect(sources.length).toBeGreaterThan(0);programs.dispose();
 });
  it('rejects failed structured preview on the actual programs instance and uses switch fallback thereafter',async()=>{
   const {programs}=setup(),structuredKeys:string[]=[];
   const verify=vi.spyOn(programs,'verifyDoubleSingle').mockResolvedValue();
   vi.spyOn(programs,'cached').mockImplementation(async(key,source)=>{
    if(key.includes(':structured:')){structuredKeys.push(key);source();throw Error('injected structured compile failure');}
    source();return {handle:{} as WebGLProgram,uniforms:new Map()} as never;
   });
   programs.setPreviewGenerator('structured');
   try{
    const first=await programs.doubleSingle(createScene('nova'),17,11);
    expect(first.generator).toBe('switch');expect(first.fallback).toContain('injected structured compile failure');
    expect(verify).toHaveBeenCalledOnce();
    const second=await programs.doubleSingle(createScene('nova'),17,11);
    expect(second.generator).toBe('switch');expect(second.fallback).toContain('injected structured compile failure');
    expect(structuredKeys).toHaveLength(1);
   }finally{programs.dispose();}
  });
  it('rejects preparation when both candidate and reference self-tests fail',async()=>{
  const {programs}=setup();const verify=vi.spyOn(programs,'verifyArithmetic').mockResolvedValue(['injected arithmetic failure']);
  await expect(programs.prepare('nova','binary64')).rejects.toThrow('Самопроверка binary64 не пройдена');
  expect(verify.mock.calls.map(call=>call[1])).toEqual(['fast','reference']);expect(programs.programs.has(programs.precisionKey)).toBe(false);programs.dispose();
 });
 it('does not start fallback after the failed candidate belongs to an obsolete context',async()=>{
  const {programs,nextGeneration}=setup();let resolve!:(value:string[])=>void;
  const verify=vi.spyOn(programs,'verifyArithmetic').mockImplementation(()=>new Promise<string[]>(done=>{resolve=done;}));
  const pending=programs.prepare('nova','binary64');nextGeneration();resolve(['obsolete candidate failure']);
  await expect(pending).rejects.toBeInstanceOf(RenderCancelledError);expect(verify).toHaveBeenCalledOnce();expect(programs.kernel).toBe('fast');programs.dispose();
 });
 it('retries the requested candidate after context restoration instead of retaining the former fallback',async()=>{
  const {programs,nextGeneration}=setup();const verify=vi.spyOn(programs,'verifyArithmetic').mockImplementation(async(_pairs,kernel)=>kernel==='reference'?[]:['first-context failure']);
  await programs.prepare('nova','binary64');expect(programs.kernel).toBe('reference');
  nextGeneration();programs.restore();verify.mockResolvedValue([]);
  expect(programs.kernel).toBe('fast');expect(programs.kernelFailure).toBeUndefined();
  await programs.prepare('nova','binary64');expect(verify.mock.calls.map(call=>call[1])).toEqual(['fast','reference','fast']);programs.dispose();
 });
 it('remembers an automatic candidate rejection across definition changes until restoration',async()=>{
  const release=vi.spyOn(kernels,'releaseKernelFor').mockReturnValue('fast');
  const gl={getExtension:()=>null,isContextLost:()=>false};
  const programs=new WebGLPrograms(gl as unknown as WebGL2RenderingContext,()=>0,()=>{});
  const verify=vi.spyOn(programs,'verifyArithmetic').mockImplementation(async(_pairs,kernel)=>kernel==='reference'?[]:['automatic candidate rejected']);
  // Skip compiler details here: the contract under test is selection/probe
  // lifetime, while compilation ownership is tested independently.
  const cached=vi.spyOn(programs,'cached').mockResolvedValue({handle:{} as WebGLProgram,uniforms:new Map()});
  programs.color={handle:{} as WebGLProgram,uniforms:new Map()};
  for(const key of ['@precision-pending','@precision-copy'])programs.programs.set(key,{handle:{} as WebGLProgram,uniforms:new Map()});
  try{
   await programs.prepare('nova','binary64',true);await programs.prepare('newton','binary64',true);await programs.prepare('nova','binary64',true);
   expect(verify.mock.calls.map(call=>call[1])).toEqual(['fast','reference']);expect(programs.kernel).toBe('reference');expect(cached).toHaveBeenCalled();
  }finally{release.mockRestore();}
 });
 it('falls back once when the candidate interpreter fails to link and does not retry it recursively',async()=>{
  const {programs,gl}=setup(),candidate=precisionSliceShader(128,'fast');let candidateLinks=0;
  vi.spyOn(programs,'verifyArithmetic').mockResolvedValue([]);
  vi.spyOn(gl,'getProgramParameter').mockImplementation(()=>{if(gl.shaderSource.mock.calls.at(-1)?.[1]===candidate){candidateLinks++;return false;}return true;});
  await programs.prepare('nova','binary64');await programs.prepare('nova','binary64');
  expect(candidateLinks).toBe(1);expect(programs.kernel).toBe('reference');expect(programs.kernelFailure).toContain('injected link failure');programs.dispose();
 });
 it('an explicit candidate request clears its previous rejection and verifies it again',async()=>{
  const {programs}=setup();const verify=vi.spyOn(programs,'verifyArithmetic').mockImplementation(async(_pairs,kernel)=>kernel==='reference'?[]:['first request rejected']);
  await programs.prepare('nova','binary64');expect(programs.kernel).toBe('reference');
  programs.setKernelVariant('fast');verify.mockResolvedValue([]);await programs.prepare('nova','binary64');
  expect(verify.mock.calls.map(call=>call[1])).toEqual(['fast','reference','fast']);expect(programs.kernel).toBe('fast');expect(programs.kernelFailure).toBeUndefined();programs.dispose();
 });
 it('a stale core compile failure cannot reject a newer kernel selection in the same context',async()=>{
  const {programs,gl}=setup(),candidate=precisionSliceShader(128,'fast');let complete=false,resume:(()=>void)|undefined;
  programs.parallel={COMPLETION_STATUS_KHR:4};programs.delay=()=>new Promise<void>(resolve=>{resume=resolve;});
  const verify=vi.spyOn(programs,'verifyArithmetic').mockResolvedValue([]);
  const parameters=vi.spyOn(gl,'getProgramParameter').mockImplementation((_program?:unknown,parameter?:number)=>{
   if(gl.shaderSource.mock.calls.at(-1)?.[1]!==candidate)return true;
   return parameter===4?complete:false;
  });
  const preparing=programs.prepare('nova','binary64');for(let i=0;i<20&&!resume;i++)await Promise.resolve();
  expect(resume).toBeTypeOf('function');programs.setKernelVariant('radix4');complete=true;resume!();
  await expect(preparing).rejects.toThrow('injected link failure');expect(programs.kernel).toBe('radix4');expect(programs.kernelFailure).toBeUndefined();
  parameters.mockReturnValue(true);await programs.prepare('nova','binary64');expect(verify.mock.calls.map(call=>call[1])).toEqual(['fast','radix4']);programs.dispose();
 });
});
