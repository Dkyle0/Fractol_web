import { afterEach, describe, expect, it, vi } from 'vitest';
import { GpuReadiness } from '../../src/rendering/webgl/readiness';

function fakeGl(statuses: number[] = []) {
  const syncs: WebGLSync[] = [], deleted: WebGLSync[] = [];
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    WAIT_FAILED: 3,
    CONDITION_SATISFIED: 4,
    ALREADY_SIGNALED: 5,
    flush: vi.fn(),
    fenceSync: vi.fn(() => { const sync = {} as WebGLSync; syncs.push(sync); return sync; }),
    clientWaitSync: vi.fn(() => statuses.shift() ?? 5),
    deleteSync: vi.fn((sync: WebGLSync) => { deleted.push(sync); }),
    isContextLost: vi.fn(() => false),
  };
  return { gl: gl as unknown as WebGL2RenderingContext, syncs, deleted };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('GPU readiness observation', () => {
  it('publishes readiness after a signalled fence and clears its last timer without drawing', async () => {
    vi.useFakeTimers();
    const { gl, syncs, deleted } = fakeGl([5]), ready = vi.fn(), fail = vi.fn(), pollMeasurements = vi.fn();
    const readiness = new GpuReadiness(gl, () => 1, pollMeasurements);
    readiness.watch(ready, fail);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(8);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    expect(gl.clientWaitSync).toHaveBeenCalledWith(syncs[0], 0, 0);
    expect(deleted).toEqual([syncs[0]]);
    expect(pollMeasurements).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports WAIT_FAILED and timeout, releasing each live sync exactly once', async () => {
    vi.useFakeTimers();
    const first = fakeGl([3]), firstReady = vi.fn(), firstFail = vi.fn();
    const failed = new GpuReadiness(first.gl, () => 1, vi.fn());
    failed.watch(firstReady, firstFail);
    await vi.advanceTimersByTimeAsync(8);
    expect(firstReady).not.toHaveBeenCalled();
    expect(firstFail).toHaveBeenCalledWith('GPU fence failed');
    expect(first.deleted).toEqual(first.syncs);
    expect(vi.getTimerCount()).toBe(0);

    vi.spyOn(performance, 'now').mockImplementationOnce(() => 0).mockImplementation(() => 30_001);
    const timeout = fakeGl([2]), timeoutFail = vi.fn();
    const timed = new GpuReadiness(timeout.gl, () => 1, vi.fn());
    timed.watch(vi.fn(), timeoutFail);
    await vi.advanceTimersByTimeAsync(8);
    expect(timeoutFail).toHaveBeenCalledWith('GPU observation timeout');
    expect(timeout.deleted).toEqual(timeout.syncs);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops obsolete-generation fences without querying or deleting old-context handles', async () => {
    vi.useFakeTimers();
    const { gl } = fakeGl(), pollMeasurements = vi.fn(); let generation = 4;
    const readiness = new GpuReadiness(gl, () => generation, pollMeasurements);
    readiness.watch(vi.fn());
    generation++;
    await vi.advanceTimersByTimeAsync(8);
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    expect(gl.deleteSync).not.toHaveBeenCalled();
    expect(gl.isContextLost).not.toHaveBeenCalled();
    expect(pollMeasurements).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clear cancels the timer and releases each active-generation sync once', async () => {
    vi.useFakeTimers();
    const { gl, syncs, deleted } = fakeGl([2, 2]), pollMeasurements = vi.fn();
    const readiness = new GpuReadiness(gl, () => 2, pollMeasurements);
    readiness.watch(vi.fn()); readiness.watch(vi.fn());
    expect(syncs).toHaveLength(2);
    readiness.clear();
    expect(deleted).toEqual(syncs);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(32);
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    expect(pollMeasurements).not.toHaveBeenCalled();
  });
});
