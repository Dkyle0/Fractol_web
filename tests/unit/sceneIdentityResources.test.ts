import { describe, expect, it } from 'vitest';
import { createScene } from '../../src/domain/catalog';
import { sameSceneMath, sceneMathKey } from '../../src/domain/sceneIdentity';
import { iterationEditorLimit, limitResourceIterations, resourcePolicies } from '../../src/domain/resources';

describe('shared mathematical and resource identities', () => {
  it('includes every scene math input while excluding palette and object key order', () => {
    const base=createScene();base.fractalId='julia';base.parameters={juliaRe:-.7,juliaIm:.2,power:2,novaRelaxation:1.1,phoenixRe:.4,phoenixIm:-.3,phoenixMemory:.6};
    const reordered={...base,parameters:Object.fromEntries(Object.entries(base.parameters).reverse()) as typeof base.parameters};
    expect(sameSceneMath(base,reordered)).toBe(true);
    const optionalUndefined={...base,parameters:{...base.parameters,phoenixMemory:undefined}};
    const optionalOmitted={...base,parameters:{...base.parameters}};delete optionalOmitted.parameters.phoenixMemory;
    expect(sameSceneMath(optionalUndefined,optionalOmitted)).toBe(true);
    const recolored={...base,coloring:{...base.coloring,palette:'ember',phase:27,density:2,interior:'white'}};
    expect(sameSceneMath(base,recolored)).toBe(true);

    const mutations:Array<(scene:ReturnType<typeof createScene>)=>void>=[
      scene=>{scene.fractalId='newton';},
      scene=>{scene.formulaVersion=2 as 1;},
      scene=>{scene.camera.x+=.01;},
      scene=>{scene.camera.y+=.01;},
      scene=>{scene.camera.height*=.99;},
      scene=>{scene.iterations++;},
      scene=>{scene.parameters.juliaRe=.1;},
      scene=>{scene.parameters.juliaIm=.1;},
      scene=>{scene.parameters.power=4;},
      scene=>{scene.parameters.novaRelaxation=1.2;},
      scene=>{scene.parameters.phoenixRe=.5;},
      scene=>{scene.parameters.phoenixIm=.5;},
      scene=>{scene.parameters.phoenixMemory=.7;},
    ];
    for(const mutate of mutations){const changed=structuredClone(base);mutate(changed);expect(sceneMathKey(changed)).not.toBe(sceneMathKey(base));}
  });

  it('keeps editor limits separate from per-mode effective iteration counts', () => {
    expect(iterationEditorLimit('standard')).toBe(2000);
    expect(iterationEditorLimit('economy')).toBe(512);
    expect(limitResourceIterations(4096,'standard')).toBe(4096);
    expect(limitResourceIterations(4096,'economy')).toBe(512);
    expect(limitResourceIterations(256,'economy')).toBe(256);
    expect(resourcePolicies.standard.targetFps).toBe(60);
    expect(resourcePolicies.economy.targetFps).toBe(30);
    expect(resourcePolicies.economy.limits).toEqual({maxDpr:1,maxPixels:600_000});
  });
});
