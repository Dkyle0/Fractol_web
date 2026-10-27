import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('benchmark-acceptance');
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { benchmarkTargets } from './lib/benchmarkAcceptance.mjs';

// Run alone: a functional browser suite or another benchmark contaminates cadence.
const newFormulas = process.argv.includes('--new');
const allFormulas=process.argv.includes('--all');
const release='v'+JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version.split('.').slice(0,2).join('.');
const series=process.env.BENCHMARK_SERIES||release;
if(!/^[a-z0-9._-]+$/i.test(series))throw new Error('BENCHMARK_SERIES must be a filename without directories');
const suffix = allFormulas?'-all':newFormulas ? '-new' : '';
const summary = { recordedAt: new Date().toISOString(), purpose: 'Reference measurements on the available GPU; no extrapolation to slower hardware', set: allFormulas||newFormulas ? `${release}-current-scenes` : 'standard-v1', runs: [] };
const gpuLoad = () => {
  try { return execFileSync('nvidia-smi.exe', ['--query-gpu=name,utilization.gpu,utilization.memory,power.draw', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim(); }
  catch { return null; }
};
await mkdir(artifactsRoot, { recursive: true });
const cases = allFormulas?['mandelbrot','julia','burning-ship','tricorn','multibrot','celtic','buffalo','perpendicular','legacy-ship','legacy-something','newton','nova','phoenix','magnet-1']:newFormulas ? ['newton', 'nova', 'phoenix', 'magnet-1'] : [1, 2, 3];
for(const channel of ['chrome','msedge'])for(const run of cases){try{await access(`${artifactsRoot}/benchmark-${series}-${channel}-${run}.json`);throw new Error('Report exists; preserve previous artifacts before starting another acceptance series');}catch(error){if(error.code!=='ENOENT')throw error;}}
for (const channel of ['chrome', 'msedge']) for (const run of cases) {
  const output = `benchmark-${series}-${channel}-${run}`, gpuBefore = gpuLoad(), launchedAt = Date.now();
  console.log(`Starting ${channel} ${run}; background GPU: ${gpuBefore ?? 'unavailable'}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/benchmark.mjs'], { env: { ...process.env, BROWSER_CHANNEL: channel, BENCHMARK_OUTPUT: output, BENCHMARK_FRACTAL: newFormulas||allFormulas ? run : '' }, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', resolve);
  });
  const gpuAfter = gpuLoad();
  let report = null;
  try { report = JSON.parse(await readFile(`${artifactsRoot}/${output}.json`, 'utf8')); } catch { /* A launch failure can have no report. */ }
  if (report && Date.parse(report.startedAt) < launchedAt - 1000) report = null;
  const rawSamplesValid = !!report && report.results.every(r => Array.isArray(r.frameIntervalsMs) && r.frameIntervalsMs.length === Math.max(0, r.frames - 1) && Array.isArray(r.gpuTimesMs) && r.gpuTimesMs.length === r.gpuSamples);
  const targets = benchmarkTargets(report);
  const passed = code === 0 && report?.status === 'completed' && report.results.length === (newFormulas||allFormulas ? 2 : 6) && targets.p95TargetMet && targets.newFieldsTargetMet;
  summary.runs.push({ channel, run, output, gpuBefore, gpuAfter, exitCode: code, rawSamplesValid, ...targets, passed: !!passed, results: report?.results.map(r => ({ id: r.scene.fractalId, lightGlass: r.lightGlass, p95FrameMs: r.p95FrameMs, p95GpuMs: r.p95GpuMs, minScale: r.minScale, maxScale: r.maxScale, frames: r.frames, completedFields:r.completedFields,newFieldsPerSecond:r.newFieldsPerSecond,p95FieldMs:r.p95FieldMs })) ?? [] });
  await writeFile(`${artifactsRoot}/benchmark-${series}${suffix}-acceptance.json`, JSON.stringify(summary, null, 2));
}
console.log(`${summary.runs.filter(r => r.passed && r.rawSamplesValid).length}/${summary.runs.length} reference runs meet 60 new fields/s and p95 <= 20ms. Results apply only to recorded hardware.`);
if (summary.runs.some(r => !r.passed || !r.rawSamplesValid)) process.exitCode = 1;
