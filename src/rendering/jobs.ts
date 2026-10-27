export type DeviceLifecycle = 'active' | 'hidden' | 'context-lost' | 'disposed';
export type JobKind = 'prepare' | 'preview' | 'refine' | 'export';
export interface RenderJob { readonly id: number; readonly sceneRevision: number; readonly contextGeneration: number; readonly kind: JobKind }
export class RenderJobs {
  lifecycle: DeviceLifecycle = 'active';
  private sequence = 0;
  private revision = 0;
  private generation = 0;
  private jobs = new Map<JobKind, number>();
  begin(kind: JobKind): RenderJob {
    const job = Object.freeze({ id: ++this.sequence, sceneRevision: this.revision, contextGeneration: this.generation, kind });
    this.jobs.set(kind, job.id); return job;
  }
  current(job: RenderJob) { return this.lifecycle === 'active' && job.sceneRevision === this.revision && job.contextGeneration === this.generation && this.jobs.get(job.kind) === job.id; }
  finish(job: RenderJob) { if (this.jobs.get(job.kind) === job.id) this.jobs.delete(job.kind); }
  invalidate() { this.revision++; this.jobs.clear(); }
  transition(lifecycle: DeviceLifecycle) {
    if (this.lifecycle === 'disposed') return;
    if (lifecycle !== this.lifecycle) this.invalidate();
    if (this.lifecycle === 'context-lost' && lifecycle !== 'context-lost') this.generation++;
    this.lifecycle = lifecycle;
  }
}
