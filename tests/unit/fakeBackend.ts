import { defaultRenderLimits } from '../../src/domain/renderLimits';
import type { RenderBackend, RenderStats, FieldRequest, ExportRequest,FieldUpdate } from '../../src/rendering/backend';
import { copyScene, type SceneState } from '../../src/domain/types';
export class FakeBackend implements RenderBackend {
  limits=defaultRenderLimits;
  stats: RenderStats={draws:0,computations:0,width:0,height:0,gpuMs:1,renderer:'test GPU',fractalId:null,gpuSampleId:0,gpuSample:null,arithmetic:'float32',phase:'preview',progress:0,computeWidth:0,computeHeight:0,timeUntilPreciseMs:null};
  preciseScene: SceneState | null=null;
  disposed=false;
  visible=true;
  setVisible(visible:boolean){this.visible=visible;}
  fields=new Set<(event:FieldUpdate)=>void>();
  subscribeFields(listener:(event:FieldUpdate)=>void){this.fields.add(listener);return()=>{this.fields.delete(listener);};}
  constructor(private control={gpuMs:1,prepare:null as null|(()=>Promise<void>)}){}
  getSnapshot(){return {...this.stats,gpuSample:this.stats.gpuSample?{...this.stats.gpuSample}:null};}
  getCapabilities(){return {renderer:'test GPU',vendor:'test',version:'test',shadingLanguage:'test',maxTextureSize:4096,gpuTimer:true,parallelCompile:false};}
  getMemoryEstimate(){return {fieldBytes:0,instructionBytes:0};}
  isContextLost(){return false;}
  prepare(){return this.control.prepare?.()??Promise.resolve();}
  resize(width:number,height:number){this.stats.width=width;this.stats.height=height;}
  preview({scene}:FieldRequest){this.stats.draws++;this.stats.fractalId=scene.fractalId;this.stats.gpuMs=this.control.gpuMs;this.stats.gpuSample={id:++this.stats.gpuSampleId,ms:this.control.gpuMs,submittedAt:performance.now(),width:this.stats.width,height:this.stats.height};}
  recolor(){this.stats.draws++;}
  async refineField({scene,progress}:FieldRequest){this.preciseScene=copyScene(scene);this.stats.computations++;progress?.(1);}
  isPrecise(scene:SceneState){const key=(value:SceneState|null)=>value&&JSON.stringify([value.fractalId,value.camera,value.parameters,value.iterations]);return key(this.preciseScene)===key(scene);}
  hasField(){return true;}
  cancelRefinement(){}
  exportFrame(_request:ExportRequest,_signal?:AbortSignal,_progress?:(value:number)=>void){return Promise.resolve(new Blob());}
  resetMeasurement(){this.stats.gpuSample=null;}
  restore(){this.preciseScene=null;}
  dispose(){this.disposed=true;}
}
