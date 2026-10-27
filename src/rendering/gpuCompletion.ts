import { settleFence, submitFence } from './gpuFence';
export { canReleaseGpuResources } from './gpuFence';
/** Cancellation is checked after drain; polling and ownership are shared with queued work. */
export async function gpuCompletion(gl: WebGL2RenderingContext, signal?: AbortSignal,ensureActive:()=>void=()=>{},wait:()=>Promise<void>=()=>new Promise(resolve=>setTimeout(resolve,4)),canRelease?:()=>boolean) {
  const result = await settleFence(gl, submitFence(gl), wait, ensureActive, canRelease);
  signal?.throwIfAborted();
  return result;
}

/** Preparation can be abandoned immediately; the shared compile still owns cleanup. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { void promise.catch(() => {}); abort(); return; }
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}
