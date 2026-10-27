import type { BenchmarkReport } from '../../src/domain/benchmark';
export function benchmarkTargets(report: Pick<BenchmarkReport, 'method' | 'results' | 'resourceMode'> | null): { p95TargetMet: boolean; newFieldsTargetMet: boolean };
