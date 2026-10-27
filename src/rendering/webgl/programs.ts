import type { FractalId } from '../../domain/types';
import { getFractal } from '../../domain/catalog';
import { coloringShader, computationShader, vertexShader,fieldProjectionShader } from '../shaders';
import { precisionSliceShader, precisionPendingShader, precisionCopyShader } from '../precisionOrbitSlices';
import { binary64ProbeSource, checkBinary64, probeBinary64, selfTestPairs,inverseProbeSource,inverseSelfTests,checkInverseSelfTest } from '../binary64Probe';
import {RELEASE_KERNEL,releaseKernelFor,kernelFeatures,kernelId,type KernelVariant} from '../kernel';
import { RenderCancelledError } from '../backend';
import { doubleSingleProgram,doubleSingleShader } from '../doubleSingleShader';
import { doubleSingleProbeShader,probeDoubleSingle } from '../doubleSingleProbe';
import type { SceneState } from '../../domain/types';
import {gpuTaskYield} from '../gpuQueue';
import {previewGeneratorFor,type PreviewGenerator} from '../previewKernel';
export interface Program { handle: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> }
interface ParallelCompile { COMPLETION_STATUS_KHR: number }
export class WebGLPrograms {
  programs = new Map<string, Program>();
  color: Program | null = null;
  parallel: ParallelCompile | null;
  fenceFloor: number | null = null;
  private pendingColor: Promise<Program> | null = null;
  private precisionCheck: Promise<void> | null = null;
  kernel:KernelVariant=RELEASE_KERNEL;
  private requestedKernel:KernelVariant|null=null;
  private releaseDefinition:FractalId|null=null;
  private rejectedKernels=new Map<KernelVariant,string>();
  kernelFailure:string|undefined;
  get precisionKey(){return '@binary64:'+kernelId(this.kernel);}
  setKernelVariant(variant:KernelVariant){this.requestedKernel=variant;this.rejectedKernels.delete(variant);this.kernel=variant;this.kernelFailure=undefined;this.precisionCheck=null;}
  private doubleSingleCheck: Promise<void> | null = null;
  doubleSingleFailure: string | undefined;
  private requestedPreview:PreviewGenerator|null=null;
  private rejectedPreviews=new Map<string,string>();
  setPreviewGenerator(generator:PreviewGenerator){this.requestedPreview=generator;this.rejectedPreviews.clear();}
  onYield:()=>void=()=>{};
  private pending = new Map<string, Promise<Program>>();
  private pollTimers = new Map<ReturnType<typeof setTimeout>, () => void>();
  constructor(private gl: WebGL2RenderingContext, private currentGeneration: () => number, private ensureActive: (generation?: number) => void) { this.parallel = gl.getExtension('KHR_parallel_shader_compile'); }
  private get generation() { return this.currentGeneration(); }
  private ownsGeneration(generation:number) { return generation===this.generation&&!this.gl.isContextLost(); }
  delay() {
    this.onYield();
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.pollTimers.delete(timer); resolve(); }, 8);
      this.pollTimers.set(timer, resolve);
    });
  }
  private publish(program: Program, generation: number, assign: (program: Program) => void) {
    try { this.ensureActive(generation); }
    catch (error) { if (this.ownsGeneration(generation)) this.gl.deleteProgram(program.handle); throw error; }
    assign(program);
    return program;
  }
  private async compile(source: string,timeoutMs=30_000,vertexSource=vertexShader): Promise<Program> {
    const gl = this.gl, generation = this.generation, parallel=this.parallel,deadline=performance.now()+timeoutMs;
    this.ensureActive(generation);
    const handle = gl.createProgram();
    if (!handle) throw new Error('Не удалось создать программу WebGL2.');
    const shaders: WebGLShader[] = [];
    try {
      for (const [type, text] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, source]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Не удалось создать шейдер.');
        shaders.push(shader); gl.shaderSource(shader, text); gl.compileShader(shader); gl.attachShader(handle, shader);
      }
      gl.linkProgram(handle);
      if (parallel) for (;;) {
        this.ensureActive(generation);
        if(gl.getProgramParameter(handle,parallel.COMPLETION_STATUS_KHR))break;
        if(performance.now()>deadline)throw Error(`Подготовка GPU-программы превысила ${timeoutMs/1000} секунд.`);
        await this.delay();
      }
      this.ensureActive(generation);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
        const details = shaders.map(s => gl.getShaderInfoLog(s)).join('\n') + gl.getProgramInfoLog(handle);
        throw new Error('Ошибка подготовки GPU-программы: ' + details);
      }
      return { handle, uniforms: new Map() };
    } catch (error) { if (this.ownsGeneration(generation)) gl.deleteProgram(handle); throw error; }
    // These handles were created here. Querying their existence before deletion
    // can synchronously wait for the GPU command buffer during cold compilation.
    finally { if(this.ownsGeneration(generation))for (const shader of shaders) gl.deleteShader(shader); }
  }
  async cached(key:string,source:()=>string,timeoutMs=30_000,vertexSource=vertexShader) {
    const generation=this.generation;this.ensureActive(generation);
    if(!this.programs.has(key)){
      let task=this.pending.get(key);
      if(!task){const work=this.compile(source(),timeoutMs,vertexSource).then(program=>this.publish(program,generation,value=>this.programs.set(key,value))).finally(()=>{if(this.pending.get(key)===work)this.pending.delete(key);});task=work;this.pending.set(key,work);}
      await task;
    }
    this.ensureActive(generation);return this.programs.get(key)!;
  }
  async verifyDoubleSingle() {
    const generation=this.generation;
    if(!this.doubleSingleCheck)this.doubleSingleCheck=(async()=>{
      const probe=await this.cached('@double-single-probe',()=>doubleSingleProbeShader);
      this.ensureActive(generation);
      const failures=await probeDoubleSingle(this.gl,probe.handle,this.onYield,()=>this.ensureActive(generation),()=>this.ownsGeneration(generation));this.ensureActive(generation);
      if(failures.length)throw Error('Самопроверка double-single не пройдена: '+failures[0]);
    })();
    try { await this.doubleSingleCheck;this.ensureActive(generation); }
    catch (error) { this.ensureActive(generation);this.doubleSingleFailure=String(error);throw error; }
  }
  async doubleSingle(scene:SceneState,width:number,height:number,flat=false) {
    const generation=this.generation;
    await this.verifyDoubleSingle();this.ensureActive(generation);
    const instructions=doubleSingleProgram(scene,width,height);
    let generator=this.requestedPreview??previewGeneratorFor(scene.fractalId);
    const key=`${flat}:${instructions.key}`,rejected=this.rejectedPreviews.get(key);
    let fallback:string|undefined=generator==='structured'?rejected:undefined;
    if(fallback)generator='switch';
    // Existing high-degree specializations can legitimately compile slowly.
    // Caller cancellation is independent of this shared cache's lifetime.
    let program:Program;
    try{program=await this.cached('@double-single:'+generator+':'+key,()=>doubleSingleShader(instructions,flat,generator),generator==='switch'?120_000:30_000);}
    catch(error){
      this.ensureActive(generation);if(generator==='switch')throw error;
      fallback=String(error);this.rejectedPreviews.set(key,fallback);generator='switch';
      program=await this.cached('@double-single:switch:'+key,()=>doubleSingleShader(instructions,flat),120_000);
    }
    await this.auxiliary();this.ensureActive(generation);return {program,instructions,generator,fallback};
  }
  async auxiliary(){for(const [key,source] of [['@precision-pending',precisionPendingShader],['@precision-copy',precisionCopyShader]])await this.cached(key!,()=>source!);}
  async precisionCapacity(registers:number) {
    const capacity=[32,48,64,128].find(n=>n>=registers);if(!capacity)throw Error('Precision register overflow');
    return this.cached(this.precisionKey+':'+capacity,()=>precisionSliceShader(capacity,this.kernel));
  }
  async verifyArithmetic(pairs = selfTestPairs,kernel:KernelVariant=this.kernel) {
    const generation=this.generation;
    const program = await this.compile(binary64ProbeSource(kernel));
    const tasks=gpuTaskYield();try {
      const failures:string[]=[],latencies:number[]=[];
      for(let i=0;i<(pairs===selfTestPairs?3:1);i++){
        this.ensureActive(generation);const result=await probeBinary64(this.gl,program.handle,pairs,this.onYield,()=>this.ensureActive(generation),tasks.wait,()=>this.ownsGeneration(generation));
        failures.push(...checkBinary64(pairs,result.words));latencies.push(result.completion.latencyMs);
      }
      this.ensureActive(generation);if(pairs===selfTestPairs)this.fenceFloor=Math.min(...latencies);
      return failures;
    }
    finally { tasks.dispose();if(this.ownsGeneration(generation))this.gl.deleteProgram(program.handle); }
  }
  private async verifyKernel(kernel:KernelVariant) {
    const failures=await this.verifyArithmetic(selfTestPairs,kernel),generation=this.generation;
    if(kernelFeatures(kernel).reciprocal){
      const program=await this.compile(inverseProbeSource(kernel)),tasks=gpuTaskYield();
      try{const result=await probeBinary64(this.gl,program.handle,inverseSelfTests,this.onYield,()=>this.ensureActive(generation),tasks.wait,()=>this.ownsGeneration(generation));failures.push(...checkInverseSelfTest(result.words));}
      finally{tasks.dispose();if(this.ownsGeneration(generation))this.gl.deleteProgram(program.handle);}
    }
    return failures;
  }
  async prepare(id: FractalId, arithmetic: 'float32' | 'binary64' = 'float32',skipCore=false):Promise<void> {
    const generation = this.generation;
    this.ensureActive(generation);
    if (arithmetic === 'binary64') {
      if(this.requestedKernel===null&&this.releaseDefinition!==id){
        const release=releaseKernelFor(id),failure=this.rejectedKernels.get(release),effective=failure?'reference':release;
        if(this.kernel!==effective){this.kernel=effective;this.precisionCheck=null;}
        this.kernelFailure=failure;
      }
      this.releaseDefinition=id;
      if (!this.precisionCheck) {
        const selected=this.kernel;
        this.precisionCheck=(async()=>{
          try{const failures=await this.verifyKernel(selected);if(failures.length)throw Error(failures[0]);}
          catch(error){
            this.ensureActive(generation);if(this.kernel!==selected)throw new RenderCancelledError();
            if(selected==='reference')throw new Error('Самопроверка binary64 не пройдена: '+String(error));
            this.kernelFailure=String(error);this.rejectedKernels.set(selected,this.kernelFailure);this.kernel='reference';
            const failures=await this.verifyKernel('reference');if(failures.length)throw Error('Самопроверка binary64 не пройдена: '+failures[0]);
          }
        })();
      }
      await this.precisionCheck; this.ensureActive(generation);
    }
    if (!this.color) {
      if (!this.pendingColor) {
        const pending = this.compile(coloringShader)
          .then(program => this.publish(program, generation, value => { this.color = value; }))
          .finally(() => { if (this.pendingColor === pending) this.pendingColor = null; });
        this.pendingColor = pending;
      }
      await this.pendingColor;
      this.ensureActive(generation);
    }
    const compiledKernel=this.kernel;
    const key = arithmetic === 'float32' ? id : this.precisionKey;
    if (!skipCore && !this.programs.has(key)) {
      let pending = this.pending.get(key);
      if (!pending) {
        const task = this.compile(arithmetic==='binary64'?precisionSliceShader(128,compiledKernel):computationShader(getFractal(id)))
          .then(program => this.publish(program, generation, value => { this.programs.set(key, value); }))
          .finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
        pending = task;
        this.pending.set(key, pending);
      }
      try{await pending;}
      catch(error){
        this.ensureActive(generation);
        if(arithmetic!=='binary64'||compiledKernel==='reference'||this.kernel!==compiledKernel)throw error;
        this.kernelFailure=String(error);this.rejectedKernels.set(this.kernel,this.kernelFailure);this.kernel='reference';this.precisionCheck=null;
        return this.prepare(id,arithmetic,skipCore);
      }
    }
    this.ensureActive(generation);
    if(arithmetic==='binary64')for(const [key,source] of [['@precision-pending',precisionPendingShader],['@precision-copy',precisionCopyShader]]){
      if(!this.programs.has(key)){
        let pending=this.pending.get(key);
        if(!pending){const task=this.compile(source).then(program=>this.publish(program,generation,value=>this.programs.set(key,value))).finally(()=>{if(this.pending.get(key)===task)this.pending.delete(key);});pending=task;this.pending.set(key,pending);}
        await pending;this.ensureActive(generation);
      }
    }
    await this.cached('@field-projection',()=>fieldProjectionShader);
    this.ensureActive(generation);
  }
  uniform(program: Program, name: string) {
    if (!program.uniforms.has(name)) program.uniforms.set(name, this.gl.getUniformLocation(program.handle, name));
    return program.uniforms.get(name)!;
  }

  restore() { this.doubleSingleFailure=undefined;this.rejectedPreviews.clear();this.rejectedKernels.clear();this.kernel=this.requestedKernel??releaseKernelFor(this.releaseDefinition??'mandelbrot');this.kernelFailure=undefined;this.doubleSingleCheck=null;this.precisionCheck = null; this.fenceFloor = null; this.programs.clear(); this.pending.clear(); this.pendingColor = null; this.color = null; this.parallel = this.gl.getExtension('KHR_parallel_shader_compile'); }
  dispose() { for (const [timer, resolve] of this.pollTimers) { clearTimeout(timer); resolve(); } this.pollTimers.clear(); for (const program of this.programs.values()) this.gl.deleteProgram(program.handle); if (this.color) this.gl.deleteProgram(this.color.handle); this.programs.clear(); this.pending.clear(); this.color = null; this.pendingColor = null; }
}
