import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScene } from '../../src/domain/catalog';
import { copyScene } from '../../src/domain/types';
import { previewFieldKey, type PreviewFieldDescriptor } from '../../src/domain/previewCache';
import { RenderCancelledError, type FieldRequest } from '../../src/rendering/backend';
import type { RenderJob } from '../../src/rendering/jobs';
import type { ResourceMode } from '../../src/domain/resources';
import type { RenderEvent } from '../../src/domain/renderEvents';
import { RenderSession, type SessionClock } from '../../src/rendering/session';
import { FakeBackend } from './fakeBackend';

class FakeClock implements SessionClock {
  time = 0; sequence = 0; frames = new Map<number, FrameRequestCallback>();
  timers: { at: number; run: () => void }[] = [];
  now = () => this.time; dpr = () => 1;
  requestFrame = (callback: FrameRequestCallback) => { this.frames.set(++this.sequence, callback); return this.sequence; };
  cancelFrame = (id: number) => { this.frames.delete(id); };
  wait = (ms: number) => new Promise<void>(resolve => { this.timers.push({ at: this.time + ms, run: resolve }); });
  async flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
  async tick(ms = 10) {
    this.time += ms;
    const due = this.timers.filter(timer => timer.at <= this.time); this.timers = this.timers.filter(timer => timer.at > this.time);
    due.forEach(timer => timer.run()); await this.flush();
    const frames = [...this.frames.values()]; this.frames.clear(); frames.forEach(callback => callback(this.time));
    await this.flush();
  }
}

class ControlledBackend extends FakeBackend {
  requests: FieldRequest[] = [];
  requestTimes: number[] = [];
  completed: number[] = [];
  completedJobs: number[] = [];
  visibleJobId: number | null = null;
  cancellations = 0;
  delay = 40;
  retain = vi.fn<(field: PreviewFieldDescriptor) => void>();
  restoreSpy = vi.fn<(field: PreviewFieldDescriptor, job: RenderJob) => boolean>(() => false);
  configure = vi.fn<(mode: ResourceMode, enabled: boolean) => void>();
  cached = new Set<string>();
  eventListeners = new Set<(event: RenderEvent) => void>();
  emitReadyEvents = false;
  eventSequence = 0;
  constructor(private clock: FakeClock) {
    super();
    Object.assign(this, {
      preview: (request: FieldRequest) => this.runPreview(request),
      cancelRefinement: () => this.cancel(),
      configurePreviewCache: this.configure,
      subscribeRenderEvents: (listener: (event: RenderEvent) => void) => { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); },
      retainPreviewField: (field: PreviewFieldDescriptor) => {
        this.retain(field); this.cached.add(previewFieldKey(field));
      },
      restorePreviewField: (field: PreviewFieldDescriptor, job: RenderJob) => {
        this.restoreSpy(field, job);
        if (!this.cached.has(previewFieldKey(field))) return false;
        this.stats.draws++; this.stats.fractalId = field.scene.fractalId; return true;
      },
    });
  }
  private active: { reject: (error: unknown) => void; settled: boolean } | null = null;
  private async runPreview(request: FieldRequest) {
    this.requests.push({ ...request, scene: copyScene(request.scene) });
    this.requestTimes.push(this.clock.now());
    let settle!: () => void, fail!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => { settle = resolve; fail = reject; });
    const operation = { reject: fail, settled: false }; this.active = operation;
    const submittedAt = this.clock.now();
    this.clock.wait(this.delay).then(() => {
      if (operation.settled) return;
      operation.settled = true; this.stats.draws++; this.stats.fractalId = request.scene.fractalId;
      this.completed.push(request.scene.parameters.juliaRe);
      this.completedJobs.push(request.job.id); this.visibleJobId = request.job.id;
      if (this.emitReadyEvents) {
        const arithmetic = request.arithmetic ?? 'float32';
        const descriptor: PreviewFieldDescriptor = { scene: request.scene, arithmetic, arithmeticVersion: 'test-v1', width: request.width ?? 100, height: request.height ?? 80 };
        const event: RenderEvent = { id: ++this.eventSequence, timestamp: this.clock.now(), type: 'field-ready', fieldId: request.job.id,
          fieldKey: previewFieldKey(descriptor), jobId: request.job.id, sceneRevision: request.job.sceneRevision,
          contextGeneration: request.job.contextGeneration, arithmetic, iterations: request.scene.iterations,
          width: descriptor.width, height: descriptor.height, submittedAt };
        for (const listener of this.eventListeners) listener(event);
      }
      settle();
    });
    return promise.finally(() => { if (this.active === operation) this.active = null; });
  }
  private cancel() {
    this.cancellations++;
    const operation = this.active;
    if (!operation || operation.settled) return;
    operation.settled = true; this.active = null; operation.reject(new RenderCancelledError());
  }
}

const sessions: RenderSession[] = [];
afterEach(() => { sessions.forEach(session => session.dispose()); sessions.length = 0; });
function setup() {
  const clock = new FakeClock(), backend = new ControlledBackend(clock), scene = createScene('julia');
  const callbacks = { stats: vi.fn(), loading: vi.fn(), error: vi.fn(), lightGlass: vi.fn() };
  const session = new RenderSession(backend, scene, callbacks, clock); sessions.push(session);
  session.resize({ width: 100, height: 80 });
  return { clock, backend, scene, session, callbacks };
}
async function pump(clock: FakeClock, predicate: () => boolean, limit = 80) {
  for (let i = 0; i < limit && !predicate(); i++) await clock.tick(10);
  expect(predicate()).toBe(true);
}
async function ready(clock: FakeClock, session: RenderSession) { await pump(clock, () => session.getViewState().ready); }
describe('viewing field readiness wait', () => {
  it('resolves only after a final field is ready', async () => {
    const { clock, session } = setup(), controller = new AbortController();
    await ready(clock, session);
    await expect(session.waitForViewingField(controller.signal)).resolves.toBeUndefined();
  });

  it('rejects when the caller aborts while the field is still pending', async () => {
    const { clock, session } = setup(), controller = new AbortController();
    const waiting = session.waitForViewingField(controller.signal);
    controller.abort(); await clock.tick(8);
    await expect(waiting).rejects.toThrow();
  });
});
async function startPointerPreview(ctx: ReturnType<typeof setup>, value: number, delay = 40) {
  ctx.backend.delay = delay;
  const scene = copyScene(ctx.scene); scene.parameters.juliaRe = value;
  ctx.session.update(scene, true, 'julia-pointer');
  await pump(ctx.clock, () => ctx.backend.requests.length > 0 && ctx.backend.requests.at(-1)!.scene.parameters.juliaRe === value);
  return scene;
}

describe('continuous Julia pointer preview', () => {
  it('keeps UI stats snapshots throttled while every ready event remains observable', async () => {
    const { clock, backend, scene, session, callbacks } = setup();
    backend.emitReadyEvents = true; backend.delay = 8;
    await ready(clock, session);
    callbacks.stats.mockClear();
    const start = clock.now(), base = backend.completed.length, moving = copyScene(scene);
    for (let i = 0; i < 60; i++) {
      moving.parameters.juliaRe = -0.9 + i / 100;
      session.update(moving, true, 'julia-pointer');
      await pump(clock, () => backend.completed.length >= base + i + 1, 8);
    }
    const elapsed = clock.now() - start;
    expect(backend.completed.length - base).toBeGreaterThanOrEqual(60);
    expect(backend.eventSequence).toBeGreaterThanOrEqual(60);
    expect(callbacks.stats.mock.calls.length).toBeLessThanOrEqual(Math.ceil(elapsed / 250) + 1);
  });

  it('does not redraw on pointer-only revisions while an atomic field is pending', async () => {
    const { clock, backend, scene, session } = setup(); await ready(clock, session);
    const base = backend.cancellations;
    const current = await startPointerPreview({ clock, backend, scene, session, callbacks: { stats: vi.fn(), loading: vi.fn(), error: vi.fn(), lightGlass: vi.fn() } }, .1, 200);
    const draws = backend.stats.draws;
    for (let i = 2; i <= 10; i++) {
      current.parameters.juliaRe = i / 10; session.update(current, true, 'julia-pointer');
      await clock.tick(5);
    }
    expect(backend.stats.draws).toBe(draws);
    expect(backend.cancellations).toBe(base);
  });

  it('limits async Julia submissions to the economy cadence under a 60 Hz RAF/input stream', async () => {
    const { clock, backend, scene, session } = setup(); await ready(clock, session);
    session.setResourceMode('economy'); await ready(clock, session);
    backend.delay = 40;
    const start = clock.time, base = backend.requests.length, moving = copyScene(scene);
    for (let i = 0; i < 125; i++) {
      moving.parameters.juliaRe = -0.8 + i / 100;
      session.update(moving, true, 'julia-pointer');
      await clock.tick(16);
    }
    const end = clock.time;
    const submitted = backend.requests.slice(base).filter((_, index) => backend.requestTimes[base + index]! >= start && backend.requestTimes[base + index]! < end);
    expect(end - start).toBe(2000);
    expect(submitted.length).toBeLessThanOrEqual(Math.ceil((end - start) / 1000 * 30) + 1);
    expect(submitted.length).toBeGreaterThan(0);
    expect(submitted.every(request => request.publication === 'atomic')).toBe(true);
  });

  it('keeps 40 ms frames running without cancellation and eventually serves only the latest coalesced value atomically', async () => {
    const { clock, backend, scene: initial, session } = setup(); await ready(clock, session);
    const cancellationBase = backend.cancellations;
    const firstCount = backend.requests.length;
    const scene = await startPointerPreview({ clock, backend, scene: initial, session, callbacks: { stats: vi.fn(), loading: vi.fn(), error: vi.fn(), lightGlass: vi.fn() } }, .1);
    const first = backend.requests.at(-1)!;
    expect(first.scene.parameters.juliaRe).toBe(.1);
    expect(first.publication).toBe('atomic');
    for (let i = 2; i <= 8; i++) {
      scene.parameters.juliaRe = i / 10;
      session.update(scene, true, 'julia-pointer');
      await clock.tick(5);
    }
    scene.parameters.juliaRe = .9; session.update(scene, true, 'julia-pointer');
    expect(backend.cancellations).toBe(cancellationBase);
    expect(backend.requests.length).toBeLessThanOrEqual(firstCount + 2);
    expect(session.getViewState().updatingJulia).toBe(true);
    expect(session.getViewState().ready).toBe(false);
    await pump(clock, () => backend.requests.length === firstCount + 2);
    expect(backend.requests.at(-1)!.scene.parameters.juliaRe).toBe(.9);
    expect(backend.completed).toContain(.1);
    expect(backend.requests.at(-1)!.publication).toBe('atomic');
    await ready(clock, session);
    expect(session.getViewState().updatingJulia).toBe(false);
    expect(session.getViewState().ready).toBe(true);
    expect(backend.cancellations).toBe(cancellationBase);
  });

  it('retires an in-flight progressive Julia job once before entering an atomic pointer series', async () => {
    const { clock, backend, scene, session } = setup(); await ready(clock, session);
    session.setQualityProfile('quality'); await ready(clock, session);
    backend.delay = 1000;
    const initialRequestCount = backend.requests.length;
    const progressiveScene = copyScene(scene); progressiveScene.parameters.juliaRe += .05;
    session.update(progressiveScene, true, 'default');
    await clock.tick(10);
    expect(backend.requests.length).toBe(initialRequestCount + 1);
    const staleProgressive = backend.requests.at(-1)!;
    expect(staleProgressive.publication).toBe('progressive');
    const cancellationBase = backend.cancellations;

    const firstPointer = copyScene(progressiveScene); firstPointer.parameters.juliaRe += .05;
    session.update(firstPointer, true, 'julia-pointer');
    expect(backend.cancellations).toBe(cancellationBase + 1);
    await clock.flush();
    expect(backend.completedJobs).not.toContain(staleProgressive.job.id);

    const secondPointer = copyScene(firstPointer); secondPointer.parameters.juliaRe += .05;
    session.update(secondPointer, true, 'julia-pointer');
    expect(backend.cancellations).toBe(cancellationBase + 1);
    backend.delay = 40;
    await clock.tick(10);
    await pump(clock, () => backend.requests.length >= initialRequestCount + 2);
    const firstAtomic = backend.requests[initialRequestCount + 1]!;
    expect(firstAtomic.publication).toBe('atomic');
    expect(firstAtomic.scene.parameters.juliaRe).toBe(secondPointer.parameters.juliaRe);

    const latestPointer = copyScene(secondPointer); latestPointer.parameters.juliaRe += .05;
    session.update(latestPointer, true, 'julia-pointer');
    await clock.tick(5);
    expect(backend.cancellations).toBe(cancellationBase + 1);
    await pump(clock, () => backend.requests.length >= initialRequestCount + 3);
    const latestAtomic = backend.requests.at(-1)!;
    expect(latestAtomic.publication).toBe('atomic');
    expect(latestAtomic.scene.parameters.juliaRe).toBe(latestPointer.parameters.juliaRe);
    await ready(clock, session);
    expect(backend.completedJobs).not.toContain(staleProgressive.job.id);
    expect(backend.cancellations).toBe(cancellationBase + 1);
  });

  it('cancels one stale pointer job at 150 ms idle and then completes the latest constant', async () => {
    const { clock, backend, scene, session } = setup(); await ready(clock, session);
    session.setQualityProfile('quality'); await ready(clock, session);
    const cancellationBase = backend.cancellations;
    const firstCount = backend.requests.length;
    const current = await startPointerPreview({ clock, backend, scene, session, callbacks: { stats: vi.fn(), loading: vi.fn(), error: vi.fn(), lightGlass: vi.fn() } }, .1, 1000);
    current.parameters.juliaRe = .8; session.update(current, true, 'julia-pointer');
    await clock.tick(150);
    expect(backend.cancellations).toBe(cancellationBase + 1);
    backend.delay = 40;
    await pump(clock, () => backend.requests.length > firstCount + 1);
    expect(backend.requests.at(-1)!.scene.parameters.juliaRe).toBe(.8);
    expect(backend.requests.at(-1)!.publication).toBe('atomic');
    await ready(clock, session);
    expect(backend.cancellations).toBe(cancellationBase + 1);
    expect(session.getViewState().ready).toBe(true);
  });

  it('does not cancel a pointer job when its completed field already matches the final request', async () => {
    const { clock, backend, scene, session } = setup(); await ready(clock, session);
    session.setQualityProfile('quality'); await ready(clock, session);
    const cancellationBase = backend.cancellations;
    await startPointerPreview({ clock, backend, scene, session, callbacks: { stats: vi.fn(), loading: vi.fn(), error: vi.fn(), lightGlass: vi.fn() } }, .2, 200);
    await clock.tick(150);
    expect(backend.cancellations).toBe(cancellationBase);
    expect(session.getViewState().ready).toBe(false);
    await ready(clock, session);
    expect(backend.cancellations).toBe(cancellationBase);
    expect(session.getViewState().ready).toBe(true);
  });

  it.each(['default-parameter', 'camera', 'iterations', 'formula', 'resource-mode'] as const)('hard-cancels non-coalescible %s changes', async change => {
    const { clock, backend, scene, session } = setup(); await ready(clock, session);
    const pointer = await startPointerPreview({ clock, backend, scene, session, callbacks: { stats: vi.fn(), loading: vi.fn(), error: vi.fn(), lightGlass: vi.fn() } }, .2, 1000);
    if (change === 'resource-mode') session.setResourceMode('economy');
    else {
      const next = copyScene(pointer);
      if (change === 'default-parameter') next.parameters.juliaIm += .1;
      if (change === 'camera') next.camera.x += .1;
      if (change === 'iterations') next.iterations++;
      if (change === 'formula') next.fractalId = 'mandelbrot';
      session.update(next, true, change === 'default-parameter' ? 'default' : 'julia-pointer');
    }
    expect(backend.cancellations).toBeGreaterThan(0);
  });

  it('never lets a cancelled stale preview publish after a hard cancellation', async () => {
    const { clock, backend, scene, session } = setup(); await ready(clock, session);
    const stale = await startPointerPreview({ clock, backend, scene, session, callbacks: { stats: vi.fn(), loading: vi.fn(), error: vi.fn(), lightGlass: vi.fn() } }, .3, 500);
    const staleJobId = backend.requests.at(-1)!.job.id;
    const replacement = copyScene(stale); replacement.camera.x += .1;
    session.update(replacement, true, 'default');
    expect(backend.cancellations).toBeGreaterThan(0);
    await clock.tick(500);
    expect(backend.completedJobs).not.toContain(staleJobId);
    expect(backend.visibleJobId).not.toBe(staleJobId);
  });

  it('does not cancel for a color-only edit', async () => {
    const { clock, backend, scene, session } = setup(); await ready(clock, session);
    const cancellationBase = backend.cancellations;
    await startPointerPreview({ clock, backend, scene, session, callbacks: { stats: vi.fn(), loading: vi.fn(), error: vi.fn(), lightGlass: vi.fn() } }, .2, 1000);
    const recolored = copyScene(sessionScene(scene, .2)); recolored.coloring.phase += .2;
    const drawsBeforeRecolor = backend.stats.draws;
    session.update(recolored, true, 'julia-pointer');
    await clock.tick(5);
    expect(backend.cancellations).toBe(cancellationBase);
    expect(backend.stats.draws).toBe(drawsBeforeRecolor + 1);
    expect(session.getViewState().ready).toBe(false);
  });
});

function sessionScene(scene: ReturnType<typeof createScene>, juliaRe: number) { const result = copyScene(scene); result.parameters.juliaRe = juliaRe; return result; }

describe('preview cache session lifecycle', () => {
  it('releases the session render-event subscription on disposal', () => {
    const { backend, session } = setup();
    expect(backend.eventListeners.size).toBe(1);
    session.dispose();
    expect(backend.eventListeners.size).toBe(0);
  });

  it('configures budgets by mode, retains only settled fields, bypasses cache for benchmarks and restores it on release', async () => {
    const { clock, backend, scene, session } = setup();
    expect(backend.configure).toHaveBeenLastCalledWith('standard', true);
    await ready(clock, session);
    expect(backend.retain).toHaveBeenCalled();
    const retainedBeforePending = backend.retain.mock.calls.length;
    const nextScene = copyScene(scene); nextScene.camera.x += .05; session.update(nextScene);
    await clock.tick(10);
    expect(backend.retain).toHaveBeenCalledTimes(retainedBeforePending);
    await ready(clock, session);
    expect(backend.retain.mock.calls.length).toBeGreaterThan(retainedBeforePending);
    session.setResourceMode('economy');
    expect(backend.configure).toHaveBeenLastCalledWith('economy', true);
    await ready(clock, session);
    const before = backend.retain.mock.calls.length;
    const lease = session.acquireOperation('benchmark');
    expect(backend.configure).toHaveBeenLastCalledWith('economy', false);
    await clock.tick(200);
    expect(backend.retain).toHaveBeenCalledTimes(before);
    lease.release();
    expect(backend.configure).toHaveBeenLastCalledWith('economy', true);
    expect(scene.fractalId).toBe('julia');
  });

  it('restores a cached field without submitting another preview', async () => {
    const { clock, backend, scene, session } = setup(); await ready(clock, session);
    const original = copyScene(scene);
    const moved = copyScene(original); moved.camera.x += .1;
    session.update(moved); await ready(clock, session);
    const before = backend.requests.length;
    session.update(original);
    await pump(clock, () => session.getViewState().ready);
    expect(backend.restoreSpy).toHaveBeenCalled();
    expect(backend.requests).toHaveLength(before);
    expect(backend.cancellations).toBeGreaterThan(0);
  });
});
