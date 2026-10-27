import { describe,expect,it } from 'vitest';
import { iterationBudget,fenceIterationBudget,precisionProgress,progressLabel } from '../../src/domain/precisionSlices';
import { createScene,fractals } from '../../src/domain/catalog';
import { preciseProgram } from '../../src/rendering/preciseProgram';
describe('bounded precise iterations',()=>{
 it('adapts work without changing the spatial batch or the scene limit',()=>{
  expect(iterationBudget(64,24)).toBe(16);expect(iterationBudget(64,3)).toBe(128);
  expect(iterationBudget(1,100)).toBe(1);expect(iterationBudget(512,0)).toBe(512);
  expect(iterationBudget(64,null)).toBe(64);expect(iterationBudget(64,NaN)).toBe(64);
 });
 it('does not confuse calibrated browser scheduling latency with the cost of an iteration',()=>{
  expect(fenceIterationBudget(64,{latencyMs:1005,polls:250},1000)).toBeGreaterThanOrEqual(64);
  expect(fenceIterationBudget(64,{latencyMs:1000,polls:1},0)).toBe(128);
  expect(fenceIterationBudget(64,{latencyMs:1050,polls:250},1000)).toBeLessThan(64);
 });
 it('keeps partial progress monotonic and below completed field progress',()=>{
  const values=[8,64,512,16384].map(n=>precisionProgress(16384,16384,n,16384,1920*1080));
  expect([...values].sort((a,b)=>a-b)).toEqual(values);expect(values.at(-1)).toBeLessThan(32768/(1920*1080));
  expect(progressLabel(0)).toBe('подготовка');expect(progressLabel(.00001)).toBe('<0,01%');expect(progressLabel(.001)).toBe('0,1%');
 });
 it('exposes only persistent orbital registers and a valid iteration boundary for all definitions',()=>{
  for(const f of fractals){const scene=createScene(f.id);for(const power of [3,8]){
   scene.parameters.power=power;const p=preciseProgram(scene,128,128);
   expect(p.stateFields).toHaveLength(4);expect(p.stateFields.every(r=>r>=0&&r<p.registers)).toBe(true);
   expect(p.resumePc).toBeGreaterThan(0);expect(p.resumePc).toBeLessThan(p.length);
  }}
 });
});
