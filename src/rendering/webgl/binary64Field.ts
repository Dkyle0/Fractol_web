import type { SceneState } from '../../domain/types';
import type { RenderStats } from '../backend';
import type { RenderJob } from '../jobs';
import type { WebGLResources } from './resources';
import type { WebGLPrograms } from './programs';
import type { WebGLMeasurements } from './measurements';
import { preciseProgram } from '../preciseProgram';
import { gpuCompletion } from '../gpuCompletion';
import { fenceTileEstimate, precisionSampleMatches, PrecisionTiles } from '../../domain/precisionTiles';
import { bindBinary64 } from './passes';
interface Context { gl: WebGL2RenderingContext; resources: WebGLResources; programs: WebGLPrograms; measurements: WebGLMeasurements; stats: RenderStats; ensureActive(): void }
export async function binary64Field(context:Context,snapshot:SceneState,width:number,height:number,signal:AbortSignal,progress:(fraction:number)=>void,job?:RenderJob) {
  const {gl,resources,programs,measurements,stats,ensureActive}=context;
      const fenceBaseline=programs.fenceFloor??0;
      stats.fenceBaselineMs=fenceBaseline;
      const program = programs.programs.get(programs.precisionKey)!, instructions=preciseProgram(snapshot,width,height,false,programs.kernel);
      resources.allocate(true, width, height); gl.useProgram(program.handle);
      bindBinary64(gl,program,(p,n)=>programs.uniform(p,n),resources,snapshot,width,height,instructions);
      stats.phase = 'refining'; stats.progress = 0;
      const started = performance.now(),tiles=new PrecisionTiles(width,height);let usedGpuId=stats.gpuSampleId;
      for (let tile=tiles.next();tile;tile=tiles.next()) {
          signal.throwIfAborted(); ensureActive();
          // Other callbacks may recolor the front between tiles: rebind every task.
          gl.bindFramebuffer(gl.FRAMEBUFFER, resources.backFramebuffer); gl.bindVertexArray(resources.vao); gl.useProgram(program.handle);
          gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,resources.instructionTexture);
          gl.viewport(0, 0, width, height); gl.enable(gl.SCISSOR_TEST); gl.scissor(tile.x,tile.y,tile.width,tile.height);
          measurements.poll();
          const queried = measurements.begin({ ...jobMetadata(job), submittedAt: performance.now(), width, height, kind:'precision', pixels:tile.width*tile.height });
          gl.drawArrays(gl.TRIANGLES,0,3); measurements.end(queried);
          gl.disable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          const completion = await gpuCompletion(gl, signal); measurements.poll();
          signal.throwIfAborted(); ensureActive();
          const sample=stats.gpuSample;
          const measured=precisionSampleMatches(sample,usedGpuId,started,width,height);
          const fallback=fenceTileEstimate(completion,fenceBaseline);
          // Fence latency also includes scheduling/queue delays. If a timer is
          // supported, keep the size until its query arrives instead of treating
          // a late result as an expensive shader. No synchronous wait is added.
          const cost = measured ? sample!.ms : measurements.available ? null : fallback.costMs;
          if(measured)usedGpuId=sample!.id;
          stats.tileTiming=measured?'gpu':measurements.available?'pending':'fence';stats.tileLatencyMs=completion.latencyMs;stats.tilePolls=completion.polls;stats.tilePixels=tile.width*tile.height;
          stats.progress = tiles.complete(tile,cost,!measured && fallback.belowResolution,measured?(sample!.pixels??tile.width*tile.height):tile.width*tile.height);
          progress(stats.progress);
      }
  return started;
}
const jobMetadata=(job?:RenderJob)=>job?{jobId:job.id,sceneRevision:job.sceneRevision,contextGeneration:job.contextGeneration}:{};
