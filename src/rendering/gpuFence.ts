/** A cancelled operation may still own live resources; a restored context cannot. */
export function canReleaseGpuResources(ensureActive: () => void, canRelease?: () => boolean) {
  try { if (canRelease) return canRelease(); ensureActive(); return true; } catch { return false; }
}

export interface GpuFence { sync: WebGLSync; started: number; polls: number }

export function submitFence(gl: WebGL2RenderingContext): GpuFence {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) throw new Error('Не удалось создать GPU fence.');
  gl.flush();
  return { sync, started: performance.now(), polls: 0 };
}

/** Drain without blocking or abandoning submitted GPU work on operation cancellation. */
export async function settleFence(
  gl: WebGL2RenderingContext, fence: GpuFence, wait: () => Promise<void>,
  ensureActive: () => void = () => {}, canRelease?: () => boolean,
) {
  try {
    for (;;) {
      ensureActive();
      if (gl.isContextLost()) throw new Error('Потерян контекст WebGL.');
      const status = gl.clientWaitSync(fence.sync, fence.polls === 0 ? gl.SYNC_FLUSH_COMMANDS_BIT : 0, 0);
      if (status === gl.WAIT_FAILED) throw new Error('Ошибка ожидания GPU.');
      if (status !== gl.TIMEOUT_EXPIRED) return { latencyMs: performance.now() - fence.started, polls: fence.polls };
      if (performance.now() - fence.started > 30_000) throw new Error('GPU не завершил задачу за 30 секунд.');
      fence.polls++;
      await wait();
    }
  } finally {
    if (canReleaseGpuResources(ensureActive, canRelease) && !gl.isContextLost()) gl.deleteSync(fence.sync);
  }
}
