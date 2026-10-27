import { describe, expect, it } from 'vitest';
import { RenderEventSamples } from '../../src/domain/renderEventSamples';
import { copyRenderCounters, emptyRenderCounters, type FieldEventSource, type RenderEvent } from '../../src/domain/renderEvents';
import { RenderEvents } from '../../src/rendering/renderEvents';

const source: FieldEventSource = {
  fieldId: 1, fieldKey: 'math-key', jobId: 2, sceneRevision: 3, contextGeneration: 4,
  arithmetic: 'float32', iterations: 128, width: 8, height: 6, submittedAt: 10,
};
function event(id: number, timestamp: number, type: RenderEvent['type'] = 'field-ready', overrides: Partial<RenderEvent> = {}): RenderEvent {
  return { ...source, id, timestamp, type, ...(type === 'presentation' ? { presentation: 'computed' as const } : {}), ...overrides };
}
const gpu = (id: number, submittedAt: number, ms = 1, kind: 'preview' | 'precision' | 'color' = 'preview') =>
  ({ id, submittedAt, ms, kind, width: 8, height: 6 });

describe('render event collection', () => {
  it('assigns unique IDs at equal timestamps, counts each event, and isolates snapshots', () => {
    const events = new RenderEvents(() => 25), received: RenderEvent[] = [];
    const unsubscribe = events.subscribe(value => received.push(value));
    const fieldId = events.nextFieldId();
    const submitted = events.emit('field-submitted', { ...source, fieldId });
    const ready = events.emit('field-ready', { ...source, fieldId });
    const presented = events.emit('presentation', { ...source, fieldId }, { presentation: 'cache' });

    expect([submitted.id, ready.id, presented.id]).toEqual([1, 2, 3]);
    expect(new Set(received.map(value => value.timestamp))).toEqual(new Set([25]));
    expect(new Set(received.map(value => value.id)).size).toBe(3);
    expect(events.snapshot()).toMatchObject({ submittedFields: 1, readyFields: 1, presentations: { cache: 1 } });
    const snapshot = events.snapshot(); snapshot.presentations.cache = 99; snapshot.readyFields = 99;
    expect(events.snapshot()).toMatchObject({ readyFields: 1, presentations: { cache: 1 } });
    expect(Object.isFrozen(ready)).toBe(true);
    unsubscribe(); events.dispose();
    events.emit('field-cancelled', { ...source, fieldId });
    expect(received).toHaveLength(3);
  });

  it('deduplicates by event ID, retains equal timestamp observations, and applies [start,end) boundaries', () => {
    const start = emptyRenderCounters(); start.submittedFields = 2;
    const samples = new RenderEventSamples(10, start);
    samples.add(event(1, 10, 'field-submitted'));
    samples.add(event(2, 10, 'field-ready'));
    samples.add(event(2, 11, 'field-cancelled')); // duplicate ID is ignored
    samples.add(event(3, 12, 'presentation'));
    samples.add(event(4, 20, 'field-ready'));
    samples.add(event(5, 9, 'field-ready'));
    samples.add(event(6, Number.NaN, 'field-ready'));
    samples.add(event(7, 13, 'field-ready', { arithmetic: 'binary64' }));
    samples.addGpu(gpu(1, 10, 2));
    samples.addGpu(gpu(1, 12, 99)); // repeated query IDs keep the first accepted observation
    samples.addGpu(gpu(2, 19, 3));
    samples.addGpu(gpu(3, 20, 4));
    samples.addGpu(gpu(4, 11, Number.NaN));
    samples.addGpu(gpu(9, Number.NaN, 8));
    samples.addGpu(gpu(5, 11, 4, 'color'));
    samples.addGpu(gpu(6, 11, 5, 'precision'));
    const end = emptyRenderCounters(); end.readyFields = 7;
    samples.close(20, end);
    samples.add(event(8, 19, 'field-ready'));
    samples.add(event(9, 20, 'field-ready'));
    samples.addGpu(gpu(7, 19, 6));
    samples.addGpu(gpu(8, 20, 7));

    const result = samples.result(true);
    expect(result.events?.map(value => value.id)).toEqual([1, 2, 3, 8]);
    expect(result.eventSamples).toBe(4);
    expect(result.fieldIntervalsMs).toEqual([9]);
    expect(result.presentationIntervalsMs).toEqual([]);
    expect(result.presentations.computed).toBe(1);
    expect(result.gpuTimesMs).toEqual([2, 3, 6]);
    expect(result.endCounters.readyFields).toBe(7);
    result.endCounters.readyFields = 0;
    expect(samples.result().endCounters.readyFields).toBe(7);
    expect(copyRenderCounters(start)).not.toBe(start);
  });

  it('accepts late-arriving GPU samples only when they belong to the closed window', () => {
    const samples = new RenderEventSamples(5, emptyRenderCounters());
    samples.close(15, emptyRenderCounters());
    samples.addGpu(gpu(1, 14, 2));
    samples.addGpu(gpu(2, 15, 3));
    expect(samples.result().gpuTimesMs).toEqual([2]);
  });

  it('counts partial, cancelled, restored, and cached outcomes with immutable boundary counters', () => {
    const start = emptyRenderCounters(); start.readyFields = 4;
    const samples = new RenderEventSamples(20, start);
    start.readyFields = 40;
    samples.add(event(10, 20, 'field-submitted'));
    samples.add(event(11, 30, 'tile-published', { tile: { x: 0, y: 0, width: 4, height: 4 } }));
    samples.add(event(12, 40, 'field-cancelled', { reason: 'replaced' }));
    samples.add(event(13, 50, 'field-restored'));
    samples.add(event(14, 50, 'presentation', { presentation: 'cache' }));
    samples.add(event(15, 60, 'field-ready', { submittedAt: 12 }));
    const end = emptyRenderCounters(); end.submittedFields = 9;
    samples.close(70, end); end.submittedFields = 90;

    const result = samples.result();
    expect(result).toMatchObject({ submittedFields: 1, completedFields: 1, cancelledFields: 1, publishedTiles: 1, restoredFields: 1,
      presentations: { computed: 0, tile: 0, reprojection: 0, repeat: 0, cache: 1 }, eventSamples: 6 });
    expect(result.fieldLatenciesMs).toEqual([48]);
    expect(result.maxFieldLatencyMs).toBe(48);
    expect(result.startCounters.readyFields).toBe(4);
    expect(result.endCounters.submittedFields).toBe(9);
  });

  it('rejects impossible measurement windows and does not expose mutable event snapshots', () => {
    const samples = new RenderEventSamples(5, emptyRenderCounters());
    expect(() => samples.result()).toThrow('still open');
    expect(() => samples.close(Number.NaN, emptyRenderCounters())).toThrow('Invalid measurement boundary');
    expect(() => samples.close(4, emptyRenderCounters())).toThrow('Invalid measurement boundary');
    samples.add(event(1, 6, 'tile-published', { tile: { x: 1, y: 2, width: 3, height: 4 } }));
    samples.close(10, emptyRenderCounters());
    const result = samples.result(true);
    Object.assign(result.events![0]!.tile!, { x: 99 });
    expect(samples.result(true).events![0]!.tile!.x).toBe(1);
  });
});
