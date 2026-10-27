import { fenceTileEstimate } from './precisionTiles';
export function fenceIterationBudget(steps:number,completion:{latencyMs:number;polls:number},baseline:number,targetMs=6) {
  const estimate=fenceTileEstimate(completion,baseline);
  return estimate.belowResolution?Math.min(512,steps*2):iterationBudget(steps,estimate.costMs,targetMs);
}
export function iterationBudget(steps:number,costMs:number|null,targetMs=6) {
  if(costMs===null||!Number.isFinite(costMs)||costMs<0)return steps;
  return Math.max(1,Math.min(512,Math.floor(Math.min(steps*2,steps*targetMs/Math.max(.01,costMs)))));
}
export function precisionProgress(completed:number,tilePixels:number,steps:number,maximumSteps:number,total:number) {
  return (completed+tilePixels*Math.min(.99,steps/maximumSteps))/total;
}
export function progressLabel(fraction:number) {
  if(fraction<=0)return 'подготовка';
  if(fraction<.0001)return '<0,01%';
  return `${(fraction*100).toLocaleString('ru-RU',{maximumFractionDigits:fraction<.01?2:1})}%`;
}
