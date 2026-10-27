// Separate the two targets: fast presentations cannot stand in for new fields.
export function benchmarkTargets(report) {
  const results = report?.results ?? [];
  const economy=report?.resourceMode==='economy',fps=economy?30:60,p95=economy?40:20;
  const viewing = /^fractol-navigation-v(?:[2-9]|[1-9]\d+)-viewing$/.test(report?.method ?? '') || ['fractol-navigation-v5-resource-modes','fractol-navigation-v6-events'].includes(report?.method);
  const p95TargetMet = results.length > 0 && results.every(r =>
    r.status === 'completed' && Number.isFinite(r.p95FrameMs) && r.p95FrameMs <= p95 &&
    (!viewing || (r.completedFields > 0 && Number.isFinite(r.p95FieldMs) && r.p95FieldMs <= p95)));
  const newFieldsTargetMet = results.length > 0 && results.every(r => {
    const rate = viewing ? r.newFieldsPerSecond : r.updatesPerSecond;
    return r.status === 'completed' && Number.isFinite(rate) && rate >= fps;
  });
  return { p95TargetMet, newFieldsTargetMet };
}
