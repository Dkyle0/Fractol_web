import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortable, gpuCompletion } from '../../src/rendering/gpuCompletion';
import { settleFence, submitFence } from '../../src/rendering/gpuFence';
import * as gpuQueue from '../../src/rendering/gpuQueue';

describe('nonblocking GPU completion', () => {
  afterEach(() => vi.useRealTimers());
  function context(statuses = [1,2]) {
    return { SYNC_GPU_COMMANDS_COMPLETE:0, SYNC_FLUSH_COMMANDS_BIT:4, WAIT_FAILED:3,TIMEOUT_EXPIRED:1,
      fenceSync:vi.fn(() => ({})),flush:vi.fn(),isContextLost:vi.fn(() => false),
      clientWaitSync:vi.fn(() => statuses.shift()??2),deleteSync:vi.fn(),
    };
  }
  it('only polls with zero timeout and releases its fence', async () => {
    vi.useFakeTimers();const gl=context();const task=gpuCompletion(gl as unknown as WebGL2RenderingContext);
    await vi.runAllTimersAsync();await task;
    expect(gl.clientWaitSync).toHaveBeenCalledTimes(2);
    expect(gl.clientWaitSync).toHaveBeenNthCalledWith(1,expect.anything(),gl.SYNC_FLUSH_COMMANDS_BIT,0);
    expect(gl.clientWaitSync.mock.calls.every(call => (call as unknown[])[2]===0)).toBe(true);
    expect(gl.deleteSync).toHaveBeenCalledTimes(1);
  });
  it('aborted tile still drains its fence before allowing the next tile', async () => {
    vi.useFakeTimers();const gl=context([1,1,2]),abort=new AbortController();let settled=false;
    const task=gpuCompletion(gl as unknown as WebGL2RenderingContext,abort.signal).catch(error => { settled=true;return error; });
    abort.abort('cancelled');await Promise.resolve();expect(settled).toBe(false);
    await vi.runAllTimersAsync();expect(await task).toBe('cancelled');expect(gl.deleteSync).toHaveBeenCalledTimes(1);
  });
  it('does not delete sync objects through a lost context', async () => {
    const gl=context();gl.isContextLost.mockReturnValue(true);
    await expect(gpuCompletion(gl as unknown as WebGL2RenderingContext)).rejects.toThrow();
    expect(gl.deleteSync).not.toHaveBeenCalled();
  });
  it('abandons preparation immediately while handling its late rejection', async () => {
    let reject!: (reason: Error) => void;const compile=new Promise<void>((_,fail) => { reject=fail; }),abort=new AbortController();
    const task=abortable(compile,abort.signal);abort.abort('cancelled');
    await expect(task).rejects.toBe('cancelled');reject(new Error('late compilation failure'));await Promise.resolve();
  });
  it.each([true,false])('separates cancelled operation from ownership of the fence: %s', async owned => {
    const gl=context(),inactive=()=>{throw new Error('disposed');};
    await expect(gpuCompletion(gl as unknown as WebGL2RenderingContext,undefined,inactive,undefined,()=>owned)).rejects.toThrow('disposed');
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    expect(gl.deleteSync).toHaveBeenCalledTimes(owned?1:0);
  });
  it('re-exports one fence lifecycle through the queue and completion modules', () => {
    expect(gpuQueue.submitFence).toBe(submitFence);
    expect(gpuQueue.settleFence).toBe(settleFence);
  });
  it('stops draining after context loss and leaves sync cleanup to the lost context', async () => {
    vi.useFakeTimers();const gl=context([1,1,2]),abort=new AbortController();
    const task=gpuCompletion(gl as unknown as WebGL2RenderingContext,abort.signal).catch(error=>error);
    abort.abort('cancelled');gl.isContextLost.mockReturnValue(true);
    await vi.runAllTimersAsync();
    expect(await task).toBeInstanceOf(Error);
    expect(gl.clientWaitSync).toHaveBeenCalledTimes(1);
    expect(gl.deleteSync).not.toHaveBeenCalled();
  });
});
