import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('benchmark');
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import os from 'node:os';

const release='v'+JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version.split('.').slice(0,2).join('.');
const output = process.env.BENCHMARK_OUTPUT || `benchmark-${release}`;
if (!/^[a-z0-9._-]+$/i.test(output)) throw new Error('Use a filename without directories for BENCHMARK_OUTPUT');
try { await access(`${artifactsRoot}/${output}.json`);throw new Error('Output exists; choose a new BENCHMARK_OUTPUT'); } catch(error){if(error.code!=='ENOENT')throw error;}
const channel = process.env.BROWSER_CHANNEL || 'chrome';
const browser = await chromium.launch({ channel, headless: process.env.HEADED !== '1' });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5173/?debug=1');
  await page.waitForFunction(() => window.__FRACTOL__?.stats()?.draws > 0);
  // New-formula CLI cases use the existing current-scene mode, never a UI mode.
  const currentId = process.env.BENCHMARK_FRACTAL;
  if (currentId && !await page.evaluate(async id => { const {fractals}=await import('/src/domain/catalog.ts');return fractals.some(f=>f.id===id); },currentId)) throw new Error('Unknown formula');
  if (currentId) {
    await page.evaluate(id => window.__FRACTOL__.select(id), currentId);
    await page.waitForFunction(id => window.__FRACTOL__.stats()?.fractalId === id, currentId);
  }
  // The UI and CLI share the runner, samples, scenes, timing and methodology.
  const report = await page.evaluate(mode => window.__FRACTOL__.benchmark(mode, true), currentId ? 'current' : 'standard');
  if (!report) throw new Error('Benchmark did not return a report');
  await mkdir(artifactsRoot, { recursive: true });
  await writeFile(`${artifactsRoot}/${output}.json`, JSON.stringify({ ...report, automation: { channel, headless: process.env.HEADED !== '1', browser: browser.version(), os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model } }, null, 2));
  const markdown = await page.evaluate(async report => {
    const { benchmarkMarkdown } = await import('/src/domain/benchmarkMarkdown.ts');
    return benchmarkMarkdown(report);
  }, report);
  await writeFile(`${artifactsRoot}/${output}.md`, markdown, 'utf8');
  await page.locator('.benchmark-results').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifactsRoot}/${output}-results.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.benchmark-results').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifactsRoot}/${output}-results-mobile.png` });
  for (const result of report.results) console.log(JSON.stringify({ id: result.scene.fractalId, lightGlass: result.lightGlass, updatesPerSecond: result.updatesPerSecond, p95FrameMs: result.p95FrameMs, p95GpuMs: result.p95GpuMs, resolutions: result.resolutions }));
  console.log(`Saved ${artifactsRoot}/${output}.json and ${artifactsRoot}/${output}.md`);
  if (report.status !== 'completed') { console.error(report.reason || 'Benchmark interrupted'); process.exitCode = 1; }
} finally { await browser.close(); }
