import { percentile } from './benchmark';
import { copyRenderCounters, type RenderCounters, type RenderEvent } from './renderEvents';
import type { GpuMeasurement } from './quality';

export interface RenderMeasurement {
  startedAt: number; endedAt: number; durationMs: number;
  startCounters: RenderCounters; endCounters: RenderCounters;
  events?: RenderEvent[];
  submittedFields: number; completedFields: number; cancelledFields: number; publishedTiles: number; restoredFields: number;
  presentations: RenderCounters['presentations'];
  presentationIntervalsMs: number[]; fieldIntervalsMs: number[]; gpuTimesMs: number[];
  maxFieldMs: number | null; maxPresentationMs: number | null;
  fieldLatenciesMs:number[];maxFieldLatencyMs:number|null;
  gpuSamples: number; eventSamples: number; cachePolicy: 'bypass';
  gpuMeasurements?: GpuMeasurement[];
}

/** Window boundaries and events use the same monotonic clock. Equal timestamps
 * are valid observations; unique IDs, rather than timestamp order, deduplicate. */
export class RenderEventSamples {
  private events: RenderEvent[] = [];
  private eventIds = new Set<number>();
  private gpu = new Map<number, GpuMeasurement>();
  private endedAt: number | null = null;
  private endCounters: RenderCounters;
  private startCounters: RenderCounters;
  constructor(readonly startedAt: number, counters: RenderCounters) {
    this.startCounters = copyRenderCounters(counters); this.endCounters = copyRenderCounters(counters);
  }
  add(event: RenderEvent) {
    if (!Number.isFinite(event.timestamp) || event.timestamp < this.startedAt ||
      (this.endedAt !== null && event.timestamp >= this.endedAt) || this.eventIds.has(event.id) || event.arithmetic.startsWith('binary64')) return;
    this.eventIds.add(event.id); this.events.push(event);
  }
  addGpu(sample: GpuMeasurement) {
    if (sample.kind !== 'preview' || !Number.isFinite(sample.submittedAt) || sample.submittedAt < this.startedAt ||
      (this.endedAt !== null && sample.submittedAt >= this.endedAt) || !Number.isFinite(sample.ms) || sample.ms < 0 || this.gpu.has(sample.id)) return;
    this.gpu.set(sample.id, { ...sample });
  }
  close(endedAt: number, counters: RenderCounters) {
    if (this.endedAt !== null) return;
    if (!Number.isFinite(endedAt) || endedAt < this.startedAt) throw Error('Invalid measurement boundary');
    this.endedAt = endedAt; this.endCounters = copyRenderCounters(counters);
  }
  result(includeEvents = false): RenderMeasurement {
    if (this.endedAt === null) throw Error('Measurement window is still open');
    const endedAt = this.endedAt;
    const events = this.events.filter(event => event.timestamp < endedAt).sort((a,b) => a.timestamp-b.timestamp || a.id-b.id);
    const times = (type: RenderEvent['type']) => events.filter(e => e.type === type).map(e => e.timestamp);
    const intervals = (values: number[]) => values.slice(1).map((value,i) => value-values[i]!);
    const fieldIntervalsMs = intervals(times('field-ready')), presentationIntervalsMs = intervals(times('presentation'));
    const fieldLatenciesMs=events.filter(event=>event.type==='field-ready'&&event.timestamp>=event.submittedAt).map(event=>event.timestamp-event.submittedAt);
    const presentations = { computed: 0, tile: 0, reprojection: 0, repeat: 0, cache: 0 };
    for (const event of events) if (event.type === 'presentation' && event.presentation) presentations[event.presentation]++;
    const count = (type: RenderEvent['type']) => events.filter(event => event.type === type).length;
    const gpuTimesMs = [...this.gpu.values()].filter(sample => sample.submittedAt < endedAt).map(sample => sample.ms);
    return { startedAt: this.startedAt, endedAt, durationMs: endedAt-this.startedAt,
      startCounters: copyRenderCounters(this.startCounters), endCounters: copyRenderCounters(this.endCounters),
      ...(includeEvents ? { events: events.map(event => ({ ...event, ...(event.tile ? {tile:{...event.tile}} : {}) })),gpuMeasurements:[...this.gpu.values()].filter(sample=>sample.submittedAt<endedAt).map(sample=>({...sample})) } : {}),
      submittedFields: count('field-submitted'), completedFields: count('field-ready'), cancelledFields: count('field-cancelled'),
      publishedTiles: count('tile-published'), restoredFields: count('field-restored'), presentations,
      fieldIntervalsMs, presentationIntervalsMs, gpuTimesMs, gpuSamples: gpuTimesMs.length, eventSamples: events.length,
      maxFieldMs: percentile(fieldIntervalsMs, 1), maxPresentationMs: percentile(presentationIntervalsMs, 1),
      fieldLatenciesMs,maxFieldLatencyMs:percentile(fieldLatenciesMs,1),cachePolicy: 'bypass' };
  }
}
