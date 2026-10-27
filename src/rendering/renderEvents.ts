import { copyRenderCounters, countRenderEvent, emptyRenderCounters, type FieldEventSource, type RenderEvent, type RenderEventType } from '../domain/renderEvents';

export class RenderEvents {
  private sequence = 0;
  private fields = 0;
  private counters = emptyRenderCounters();
  private listeners = new Set<(event: RenderEvent) => void>();
  constructor(private now: () => number = () => performance.now()) {}
  nextFieldId() { return ++this.fields; }
  snapshot() { return copyRenderCounters(this.counters); }
  subscribe(listener: (event: RenderEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(type: RenderEventType, source: FieldEventSource, detail: Pick<RenderEvent, 'presentation' | 'tile' | 'reason'> = {}) {
    const event: RenderEvent = Object.freeze({ ...source, ...detail, ...(detail.tile ? { tile: Object.freeze({ ...detail.tile }) } : {}),
      id: ++this.sequence, timestamp: this.now(), type });
    countRenderEvent(this.counters, event);
    for (const listener of this.listeners) listener(event);
    return event;
  }
  dispose() { this.listeners.clear(); }
}
