import { submitFence, type GpuFence } from '../gpuFence';

/** One bounded timer for pending observations, no drawing or serialization of
 * normal float32 submissions. All resource callbacks are generation-guarded. */
export class GpuReadiness {
  private pending: { fence: GpuFence; generation: number; ready: () => void; fail: (reason: string) => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private gl: WebGL2RenderingContext, private generation: () => number, private pollMeasurements: () => void) {}
  watch(ready: () => void, fail: (reason: string) => void = () => {}) {
    try { this.pending.push({ fence: submitFence(this.gl), generation: this.generation(), ready, fail }); this.schedule(); }
    catch (error) { fail(String(error)); }
  }
  private schedule() { if (!this.timer && this.pending.length) this.timer = setTimeout(() => { this.timer = undefined; this.poll(); }, 8); }
  poll() {
    const gl = this.gl;
    while (this.pending.length) {
      const item = this.pending[0]!;
      if (item.generation !== this.generation() || gl.isContextLost()) { this.pending.shift(); continue; }
      const status = gl.clientWaitSync(item.fence.sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED && performance.now() - item.fence.started <= 30_000) break;
      this.pending.shift(); gl.deleteSync(item.fence.sync);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) item.ready();
      else item.fail(status === gl.WAIT_FAILED ? 'GPU fence failed' : 'GPU observation timeout');
    }
    this.pollMeasurements(); this.schedule();
  }
  clear(release = true) {
    clearTimeout(this.timer); this.timer = undefined;
    if (release && !this.gl.isContextLost()) for (const item of this.pending) if (item.generation === this.generation()) this.gl.deleteSync(item.fence.sync);
    this.pending = [];
  }
}
