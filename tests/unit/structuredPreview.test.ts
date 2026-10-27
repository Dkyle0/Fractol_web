import {describe,it,expect} from 'vitest';
import {fractals,createScene} from '../../src/domain/catalog';
import {doubleSingleProgram,doubleSingleShader} from '../../src/rendering/doubleSingleShader';
import {structuredPreviewLoop} from '../../src/rendering/structuredPreview';

describe('structured double-single preview lowering',()=>{
 it('lowers all fourteen formula control flows into structured loop code without a pc switch',()=>{
  for(const definition of fractals){
   const program=doubleSingleProgram(createScene(definition.id),65,33);
   const lowered=structuredPreviewLoop(program,(instruction,index)=>`r${instruction[1]}=r${instruction[2]}; // ${index}`);
   expect(lowered,definition.id).not.toBeNull();
   const shader=doubleSingleShader(program,false,'structured');
   expect(shader,definition.id).toContain('for(int orbitStep=0;');
   expect(shader,definition.id).not.toMatch(/switch\s*\(\s*pc\s*\)/);
   expect(shader,definition.id).not.toContain('Preview structure exceeds compilation budget');
  }
 });
 it('rejects an unsupported backward jump and an oversized generated body',()=>{
  const backward={instructions:[[0,0,0,0],[12,1,0,0]],resumePc:1,stateFields:[]};
  expect(structuredPreviewLoop(backward,()=>'' )).toBeNull();
  const oversized={instructions:Array.from({length:2000},()=>[0,0,0,0]),resumePc:1999,stateFields:[]};
  expect(structuredPreviewLoop(oversized,()=>`/*${'x'.repeat(120)}*/`)).toBeNull();
 });
});
