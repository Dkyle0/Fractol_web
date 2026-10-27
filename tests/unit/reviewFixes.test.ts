import { describe, expect, it, vi } from 'vitest';
import { BenchmarkSamples } from '../../src/domain/benchmark';
import { createScene } from '../../src/domain/catalog';
import { publishFieldTile } from '../../src/rendering/webgl/publishTile';
import { benchmarkTargets } from '../../scripts/lib/benchmarkAcceptance.mjs';
import { WebGLMeasurements } from '../../src/rendering/webgl/measurements';
import type { RenderStats } from '../../src/rendering/backend';

describe('review regressions', () => {
  it('presents each published tile once, retaining presentation for offscreen clients', () => {
    const present = vi.fn(), publishTile = vi.fn(() => present());
    const tile = { x: 0, y: 0, width: 16, height: 16 };
    publishFieldTile({ publishTile, present }, tile);
    expect(publishTile).toHaveBeenCalledWith(tile); expect(present).toHaveBeenCalledTimes(1);
    publishFieldTile({ present }, tile); expect(present).toHaveBeenCalledTimes(2);
  });

  it('collects every valid compute query in a batch, excludes color, disjoint and duplicates', () => {
    let disjoint = false, nextQuery = 0;
    const values = [40, 1, 3, 99, 7];
    const gl = {
      QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
      getExtension: () => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 }),
      createQuery: () => ({ index: nextQuery++ }), beginQuery: vi.fn(), endQuery: vi.fn(), deleteQuery: vi.fn(),
      getParameter: () => disjoint,
      getQueryParameter: (q: { index: number }, key: number) => key === 1 ? true : values[q.index]! * 1e6,
    } as unknown as WebGL2RenderingContext;
    const stats = { gpuSampleId: 0, gpuMs: null, gpuSample: null } as unknown as RenderStats;
    const measurements = new WebGLMeasurements(gl, stats), samples = new BenchmarkSamples();
    const off = measurements.subscribe(sample => { samples.addGpu(sample); samples.addGpu(sample); });
    const submit = (kind: 'preview' | 'color' | 'precision') => measurements.end(measurements.begin({ kind, width: 32, height: 32, submittedAt: 1 }));
    submit('preview'); submit('color'); submit('precision'); measurements.poll();
    // The frame snapshot contains only the last query; collecting it again must not alter the query distribution.
    samples.add({ timestamp: 20, stats: { ...stats, scale: 1, width: 32, height: 32 } });
    submit('preview'); disjoint = true; measurements.poll(); disjoint = false;
    submit('preview'); measurements.poll(); off();
    const result = samples.result({ scene: createScene(), lightGlass: false }, 1000, false, 'completed', true);
    expect(result.gpuTimesMs).toEqual([40, 3, 7]);
    expect(result).toMatchObject({ gpuSamples: 3, p95GpuMs: 40 });
    measurements.dispose();
  });

  it('requires both sustained new fields and latency, never only a short burst or reprojections', () => {
    const base = new BenchmarkSamples().result({ scene: createScene(), lightGlass: false }, 10_000, false, 'completed');
    const report = (rate: number, fields: number, p95: number | null) => ({ method: 'fractol-navigation-v4-viewing', results: [{ ...base, frames: 600, updatesPerSecond: 60, p95FrameMs: 16, completedFields: fields, newFieldsPerSecond: rate, p95FieldMs: p95 }] });
    expect(benchmarkTargets(report(.2, 2, 16))).toEqual({ p95TargetMet: true, newFieldsTargetMet: false });
    expect(benchmarkTargets(report(0, 0, null))).toEqual({ p95TargetMet: false, newFieldsTargetMet: false });
    expect(benchmarkTargets(report(60, 600, 16))).toEqual({ p95TargetMet: true, newFieldsTargetMet: true });
    expect(benchmarkTargets(report(60, 600, 30))).toEqual({ p95TargetMet: false, newFieldsTargetMet: true });
    expect(benchmarkTargets(report(Number.NaN, 600, 16)).newFieldsTargetMet).toBe(false);
    expect(benchmarkTargets(null)).toEqual({ p95TargetMet: false, newFieldsTargetMet: false });
    const v6 = { method: 'fractol-navigation-v6-events', results: [{ ...base, updatesPerSecond: 60, completedFields: 2, newFieldsPerSecond: .2, p95FrameMs: 16, p95FieldMs: 16 }] };
    expect(benchmarkTargets(v6)).toEqual({ p95TargetMet: true, newFieldsTargetMet: false });
  });
});
