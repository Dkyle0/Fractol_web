/** Host-observed events. Neither presentation submission nor fence observation
 * measures the instant at which a physical monitor displays an image. */
export type PresentationKind = 'computed' | 'tile' | 'reprojection' | 'repeat' | 'cache';
export type RenderEventType = 'field-submitted' | 'field-ready' | 'field-cancelled' | 'tile-published' | 'presentation' | 'field-restored';
export interface RenderEvent {
  readonly id: number;
  readonly timestamp: number;
  readonly type: RenderEventType;
  readonly fieldId: number;
  readonly fieldKey: string;
  readonly jobId: number;
  readonly sceneRevision: number;
  readonly contextGeneration: number;
  readonly arithmetic: string;
  readonly iterations: number;
  readonly width: number;
  readonly height: number;
  readonly submittedAt: number;
  readonly presentation?: PresentationKind;
  readonly tile?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly reason?: string;
}
export type FieldEventSource = Omit<RenderEvent, 'id' | 'timestamp' | 'type' | 'presentation' | 'tile' | 'reason'>;
export interface RenderCounters {
  submittedFields: number; readyFields: number; cancelledFields: number; publishedTiles: number; restoredFields: number;
  presentations: Record<PresentationKind, number>;
}
export function emptyRenderCounters(): RenderCounters {
  return { submittedFields: 0, readyFields: 0, cancelledFields: 0, publishedTiles: 0, restoredFields: 0,
    presentations: { computed: 0, tile: 0, reprojection: 0, repeat: 0, cache: 0 } };
}
export function copyRenderCounters(value: RenderCounters): RenderCounters {
  return { ...value, presentations: { ...value.presentations } };
}
export function countRenderEvent(counters: RenderCounters, event: RenderEvent) {
  if (event.type === 'field-submitted') counters.submittedFields++;
  else if (event.type === 'field-ready') counters.readyFields++;
  else if (event.type === 'field-cancelled') counters.cancelledFields++;
  else if (event.type === 'tile-published') counters.publishedTiles++;
  else if (event.type === 'field-restored') counters.restoredFields++;
  else if (event.presentation) counters.presentations[event.presentation]++;
}
