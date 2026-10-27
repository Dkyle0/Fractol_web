import type { RenderStats } from '../backend';
import type { GpuMeasurement } from '../../domain/quality';
interface TimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
export class WebGLMeasurements {
  private timer: TimerExtension | null;
  private query: WebGLQuery | null = null;
  private source: Omit<GpuMeasurement, 'id' | 'ms'> | null = null;
  private pending:{query:WebGLQuery;source:Omit<GpuMeasurement,'id'|'ms'>}[]=[];
  private listeners=new Set<(sample:GpuMeasurement)=>void>();
  subscribe(listener:(sample:GpuMeasurement)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  constructor(private gl: WebGL2RenderingContext, private stats: RenderStats) { this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2'); }
  get available() { return !!this.timer; }
  get hasPending() { return this.pending.length>0; }
  begin(source: Omit<GpuMeasurement, 'id' | 'ms'>) {
    if (!this.timer || this.query || this.pending.length>=32) return false;
    this.query = this.gl.createQuery();
    if (!this.query) return false;
    this.source = source; this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.query); return true;
  }
  end(active: boolean) { if (active && this.timer && this.query && this.source) {this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);this.pending.push({query:this.query,source:this.source});this.query=null;this.source=null;} }
  reset() {
    if (this.query) this.gl.deleteQuery(this.query);
    for(const entry of this.pending)this.gl.deleteQuery(entry.query);this.pending=[];
    this.query = null; this.source = null; this.stats.gpuMs = null; this.stats.gpuSample = null;
  }
  poll() {
    const gl = this.gl;
    if (!this.pending.length || !this.timer) return;
    if (gl.getParameter(this.timer.GPU_DISJOINT_EXT)) { this.reset(); return; }
    while(this.pending.length){
    const entry=this.pending[0]!;if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) return;
    this.pending.shift();const ms = Number(gl.getQueryParameter(entry.query, gl.QUERY_RESULT)) / 1_000_000;
    if (Number.isFinite(ms) && ms >= 0) {
      this.stats.gpuMs = ms;
      this.stats.gpuSample = { ...entry.source, id: ++this.stats.gpuSampleId, ms };
      for(const listener of this.listeners)listener({...this.stats.gpuSample});
    } else { this.stats.gpuMs = null; this.stats.gpuSample = null; }
    gl.deleteQuery(entry.query);
    }
  }
  restore() { this.pending=[];this.query = null; this.source = null; this.stats.gpuMs = null; this.stats.gpuSample = null; this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2'); }
  dispose(){this.reset();this.listeners.clear();}
}
