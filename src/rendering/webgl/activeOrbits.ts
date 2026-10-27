import type {OrbitContext} from './orbitSlicedField';
import type {Program} from './programs';
import type {RenderJob} from '../jobs';
import {submitFence,settleFence,gpuTaskYield,type GpuFence} from '../gpuQueue';
import {canReleaseGpuResources} from '../gpuCompletion';
import {ACTIVE_ORBIT_MEMORY_LIMIT} from '../../domain/activeOrbits';

const header=`#version 300 es
precision highp float;precision highp int;
uniform highp usampler2D u_meta,u_scan;
uniform int u_side,u_width,u_count,u_stride;
out uint result;
void main(){ivec2 at=ivec2(gl_FragCoord.xy);int id=at.y*u_side+at.x;
 if(u_stride==0){result=id<u_count&&texelFetch(u_meta,ivec2(id%u_width,id/u_width),0).y==0u?1u:0u;return;}
 result=texelFetch(u_scan,at,0).r;
 if(id>=u_stride){int source=id-u_stride;result+=texelFetch(u_scan,ivec2(source%u_side,source/u_side),0).r;}}
`;
const gather=`#version 300 es
precision highp float;precision highp int;
uniform highp usampler2D u_scan,u_saved0,u_saved1,u_meta;
uniform int u_side,u_width,u_count,u_active;
layout(location=0) out uvec4 state0;layout(location=1) out uvec4 state1;layout(location=2) out uvec4 stateMeta;
void main(){ivec2 at=ivec2(gl_FragCoord.xy);int id=at.y*u_side+at.x;
 if(id>=u_active){state0=uvec4(0u);state1=uvec4(0u);stateMeta=uvec4(0u,1u,0u,0u);return;}
 int lo=0,hi=u_count-1;
 for(int step=0;step<15;step++){if(lo>=hi)break;int middle=(lo+hi)/2;
  uint rank=texelFetch(u_scan,ivec2(middle%u_side,middle/u_side),0).r;
  if(rank<=uint(id))lo=middle+1;else hi=middle;}
 ivec2 source=ivec2(lo%u_width,lo/u_width);
 state0=texelFetch(u_saved0,source,0);state1=texelFetch(u_saved1,source,0);stateMeta=texelFetch(u_meta,source,0);
}`;
const scatterVertex=`#version 300 es
precision highp float;precision highp int;
uniform highp usampler2D u_meta;
uniform int u_width,u_count,u_tileWidth;
uniform ivec2 u_origin;uniform vec2 u_resolution;
flat out uint packed;
void main(){int id=gl_VertexID;uvec4 meta=texelFetch(u_meta,ivec2(id%u_width,id/u_width),0);
 packed=meta.z;gl_PointSize=1.;
 if(id>=u_count||meta.y==0u){gl_Position=vec4(2.,2.,0.,1.);return;}
 ivec2 pixel=u_origin+ivec2(int(meta.w)%u_tileWidth,int(meta.w)/u_tileWidth);
 gl_Position=vec4((vec2(pixel)+.5)/u_resolution*2.-1.,0.,1.);
}`;
const scatterFragment=`#version 300 es
precision highp float;precision highp int;
flat in uint packed;out vec4 result;
void main(){result=vec4(float(packed>>24u),float((packed>>16u)&255u),float((packed>>8u)&255u),float(packed&255u))/255.;}`;

/** GPU-only inclusive prefix scan and stable gather. Only the total count is
 * read through a PBO after a fence; orbit state never crosses to the CPU. */
export class ActiveOrbits {
  private scans:WebGLTexture[]=[];
  private fb:WebGLFramebuffer|null=null;
  private pbo:WebGLBuffer|null=null;
  private scan!:Program;private gather!:Program;private scatter!:Program;
  private scanRead=0;private accounted=false;
  private counter:GpuFence|null=null;
  readonly bytes:number;
  private tasks=gpuTaskYield();
  constructor(private context:OrbitContext,readonly side:number,private job?:RenderJob,private outputWidth=0,private outputHeight=0){this.bytes=side*side*8+4;}
  async prepare(signal:AbortSignal){
    const {gl,programs,resources}=this.context;
    if(resources.scratchBytes+this.bytes>ACTIVE_ORBIT_MEMORY_LIMIT)throw Error('Недостаточно бюджета памяти для уплотнения орбит.');
    signal.throwIfAborted();this.scan=await programs.cached('@active-scan',()=>header);
    signal.throwIfAborted();this.gather=await programs.cached('@active-gather',()=>gather);
    signal.throwIfAborted();this.scatter=await programs.cached('@active-scatter',()=>scatterFragment,30_000,scatterVertex);
    signal.throwIfAborted();this.context.ensureActive();
    this.fb=gl.createFramebuffer();this.pbo=gl.createBuffer();if(!this.fb||!this.pbo)throw Error('Не удалось создать счётчик активных орбит.');
    for(let i=0;i<2;i++){
      const texture=gl.createTexture();if(!texture)throw Error('Не удалось выделить prefix-scan.');this.scans.push(texture);
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.R32UI,this.side,this.side,0,gl.RED_INTEGER,gl.UNSIGNED_INT,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Prefix-scan не поддерживается устройством.');
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,this.pbo);gl.bufferData(gl.PIXEL_PACK_BUFFER,4,gl.STREAM_READ);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    if(gl.getError()!==gl.NO_ERROR)throw Error('Не удалось выделить память prefix-scan.');
    resources.scratchBytes+=this.bytes;this.accounted=true;
  }
  private bind(texture:WebGLTexture,unit:number){const {gl}=this.context;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);}
  private location(p:Program,name:string){return this.context.programs.uniform(p,name);}
  private timing(stage:'active-scan'|'active-pack'|'active-scatter'){
    const {measurements}=this.context;measurements.poll();return measurements.begin({jobId:this.job?.id,sceneRevision:this.job?.sceneRevision,contextGeneration:this.job?.contextGeneration,kind:'precision',stage,submittedAt:performance.now(),width:this.outputWidth,height:this.outputHeight});
  }
  /** Submit one counter snapshot. Its prefix data is not safe for a later pack
   * if orbit banks have changed: pack admission must recount stable banks. */
  submitCount(meta:WebGLTexture,width:number,count:number,signal:AbortSignal){
    const {gl,resources,measurements}=this.context;
    if(this.counter)throw Error('Предыдущий счётчик орбит ещё не получен.');
    const stats=this.context.stats,started=performance.now();stats.activityProbes=(stats.activityProbes??0)+1;
    signal.throwIfAborted();this.context.ensureActive();
    const timed=this.timing('active-scan');
    try{
      gl.bindVertexArray(resources.vao);gl.useProgram(this.scan.handle);gl.viewport(0,0,this.side,this.side);
      this.bind(meta,5);gl.uniform1i(this.location(this.scan,'u_meta'),5);gl.uniform1i(this.location(this.scan,'u_scan'),6);
      gl.uniform1i(this.location(this.scan,'u_side'),this.side);gl.uniform1i(this.location(this.scan,'u_width'),width);gl.uniform1i(this.location(this.scan,'u_count'),count);
      let read=0;
      for(let stride=0;stride<this.side*this.side;stride=stride===0?1:stride*2){
        const write=1-read;gl.bindFramebuffer(gl.FRAMEBUFFER,this.fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.scans[write]!,0);
        this.bind(this.scans[read]!,6);gl.uniform1i(this.location(this.scan,'u_stride'),stride);gl.drawArrays(gl.TRIANGLES,0,3);read=write;
      }
      this.scanRead=read;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER,this.pbo);gl.readPixels((count-1)%this.side,Math.floor((count-1)/this.side),1,1,gl.RED_INTEGER,gl.UNSIGNED_INT,0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
      if(gl.getError()!==gl.NO_ERROR)throw Error('Не удалось отправить счётчик активных орбит.');
    }finally{measurements.end(timed);gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.context.present?.();}
    stats.activitySubmitMs=(stats.activitySubmitMs??0)+performance.now()-started;
    this.counter=submitFence(gl);
  }
  /** Null means not ready. Called from the existing orbit loop, never a poll loop. */
  pollCount(signal:AbortSignal):number|null {
    signal.throwIfAborted();this.context.ensureActive();
    const fence=this.counter;if(!fence)return null;
    const {gl}=this.context,status=gl.clientWaitSync(fence.sync,0,0);
    if(status===gl.WAIT_FAILED)throw Error('Ошибка ожидания счётчика орбит.');
    if(status===gl.TIMEOUT_EXPIRED){
      if(performance.now()-fence.started>30_000)throw Error('GPU не завершил счётчик орбит за 30 секунд.');
      return null;
    }
    this.counter=null;gl.deleteSync(fence.sync);
    this.context.stats.activityLatencyMs=(this.context.stats.activityLatencyMs??0)+performance.now()-fence.started;
    return this.readCount();
  }
  get countPending(){return this.counter!==null;}
  discardCount(){
    const fence=this.counter;this.counter=null;
    if(fence&&canReleaseGpuResources(this.context.ensureActive,this.context.canRelease)&&!this.context.gl.isContextLost())this.context.gl.deleteSync(fence.sync);
  }
  async count(meta:WebGLTexture,width:number,count:number,signal:AbortSignal){
    this.submitCount(meta,width,count,signal);
    const fence=this.counter!;this.counter=null;
    const {gl,stats}=this.context;
    const waitStarted=performance.now();
    await settleFence(gl,fence,this.tasks.wait,this.context.ensureActive,this.context.canRelease);
    stats.activityWaitMs=(stats.activityWaitMs??0)+performance.now()-waitStarted;
    stats.activityLatencyMs=(stats.activityLatencyMs??0)+performance.now()-fence.started;
    signal.throwIfAborted();this.context.ensureActive();
    return this.readCount();
  }
  private readCount(){
    const {gl,measurements,stats}=this.context;measurements.poll();
    const readStarted=performance.now(),result=new Uint32Array(1);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,this.pbo);try{gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,result);}finally{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);}
    if(gl.getError()!==gl.NO_ERROR)throw Error('Не удалось прочитать счётчик активных орбит.');
    stats.activityReadMs=(stats.activityReadMs??0)+performance.now()-readStarted;
    return result[0]!;
  }
  pack(textures:readonly WebGLTexture[],target:WebGLFramebuffer,width:number,count:number,active:number){
    const {gl,resources,measurements}=this.context;this.context.ensureActive();const timed=this.timing('active-pack');
    try{
      gl.bindVertexArray(resources.vao);gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.viewport(0,0,this.side,Math.ceil(active/this.side));gl.useProgram(this.gather.handle);
      for(let i=0;i<3;i++){this.bind(textures[i]!,2+i);gl.uniform1i(this.location(this.gather,['u_saved0','u_saved1','u_meta'][i]!),2+i);}
      this.bind(this.scans[this.scanRead]!,6);gl.uniform1i(this.location(this.gather,'u_scan'),6);
      for(const [name,value] of [['u_side',this.side],['u_width',width],['u_count',count],['u_active',active]] as const)gl.uniform1i(this.location(this.gather,name),value);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }finally{measurements.end(timed);gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.context.present?.();}
  }
  publish(meta:WebGLTexture,width:number,count:number,tile:{x:number;y:number;width:number},outputWidth:number,outputHeight:number){
    const {gl,resources,measurements}=this.context;this.context.ensureActive();const timed=this.timing('active-scatter');
    try{
      gl.bindVertexArray(resources.vao);gl.bindFramebuffer(gl.FRAMEBUFFER,resources.backFramebuffer);gl.viewport(0,0,outputWidth,outputHeight);gl.useProgram(this.scatter.handle);this.bind(meta,5);
      gl.uniform1i(this.location(this.scatter,'u_meta'),5);gl.uniform1i(this.location(this.scatter,'u_width'),width);gl.uniform1i(this.location(this.scatter,'u_count'),count);gl.uniform1i(this.location(this.scatter,'u_tileWidth'),tile.width);
      gl.uniform2i(this.location(this.scatter,'u_origin'),tile.x,tile.y);gl.uniform2f(this.location(this.scatter,'u_resolution'),outputWidth,outputHeight);gl.drawArrays(gl.POINTS,0,count);
    }finally{measurements.end(timed);gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.context.present?.();}
  }
  dispose(){
    this.discardCount();
    this.tasks.dispose();const {gl,resources}=this.context;
    if(canReleaseGpuResources(this.context.ensureActive,this.context.canRelease)&&!gl.isContextLost()){
      for(const texture of this.scans)gl.deleteTexture(texture);if(this.fb)gl.deleteFramebuffer(this.fb);if(this.pbo)gl.deleteBuffer(this.pbo);
    }
    this.scans=[];this.fb=null;this.pbo=null;
    // Caller owns total scratch accounting, including partial allocation failures.
    if(this.accounted)resources.scratchBytes=Math.max(0,resources.scratchBytes-this.bytes);this.accounted=false;
  }
}
