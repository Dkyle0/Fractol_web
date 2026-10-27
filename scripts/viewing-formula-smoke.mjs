import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('viewing-formula-smoke');
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const output = process.env.VIEWING_FORMULA_OUTPUT || 'viewing-formula-smoke';
if (!/^[a-z0-9._-]+$/i.test(output)) throw new Error('Invalid VIEWING_FORMULA_OUTPUT');
try { await access(`${artifactsRoot}/${output}.json`); throw new Error('Output exists; choose a new VIEWING_FORMULA_OUTPUT'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { windowsHide: true, stdio: 'pipe' });
let browser;
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; }); server.stderr.on('data', chunk => { serverOutput += chunk; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode != null) throw new Error(serverOutput);
    try { ready = (await fetch('http://127.0.0.1:5173/')).ok; } catch { /* Wait for Vite startup. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, `Vite did not start. ${serverOutput}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } }), errors = [], results = [];
  page.setDefaultTimeout(30_000); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/?debug=1');
  await page.waitForFunction(() => window.__FRACTOL__?.stats()?.draws > 0);
  const ids = await page.evaluate(async () => { const { fractals } = await import('/src/domain/catalog.ts'); return fractals.map(item => item.id); });
  for (const id of ids) {
    const start = await page.evaluate(async id => {
      const { createScene } = await import('/src/domain/catalog.ts'), scene = createScene(id); scene.iterations = 64;
      window.__FRACTOL__.setScene(scene); return scene;
    }, id);
    await page.waitForFunction(id => { const stats = window.__FRACTOL__.stats(); return stats.fractalId === id && stats.viewing.ready; }, id);
    const startView = await page.evaluate(() => { const s = window.__FRACTOL__.stats(); return { arithmetic: s.viewing.arithmetic, overview: s.viewing.overview, iterations: s.viewing.effectiveIterations, ready: s.viewing.ready, computations: s.computations, width: s.computeWidth, height: s.computeHeight }; });
    assert.equal(startView.arithmetic, 'float32', `${id} start should use float32`);
    assert.equal(startView.overview, false, `${id} start should not be clamped`);
    assert.equal(startView.iterations, 64);
    const deep = await page.evaluate(id => { const scene = window.__FRACTOL__.scene(); scene.camera = { x: 3, y: 3, height: 1e-12 }; scene.iterations = 64; window.__FRACTOL__.setScene(scene); return scene; }, id);
    await page.waitForFunction(id => { const stats = window.__FRACTOL__.stats(); return stats.fractalId === id && stats.viewing.ready && stats.viewing.overview; }, id);
    const deepView = await page.evaluate(() => { const s = window.__FRACTOL__.stats(); return { arithmetic: s.viewing.arithmetic, requestedHeight: s.viewing.requestedCamera.height, height: s.viewing.camera.height, minimumHeight: s.viewing.minimumHeight, overview: s.viewing.overview, iterations: s.viewing.effectiveIterations, ready: s.viewing.ready, computations: s.computations, width: s.computeWidth, heightPixels: s.computeHeight, warning: s.viewing.warning }; });
    assert.equal(deepView.arithmetic, 'double-single', `${id} near-floor preview should use DS`);
    assert.equal(deepView.overview, true); assert(deepView.height > deep.camera.height);
    assert.equal(deepView.iterations, 64); assert.equal(deepView.ready, true);
    results.push({ id, requestedCamera: start.camera, start: startView, nearDsFloor: deepView });
    console.log(`${id}: start=${startView.arithmetic}/${startView.iterations} ready; DS-floor=${deepView.arithmetic}/${deepView.iterations} height ${deepView.requestedHeight}->${deepView.height} ready`);
  }
  assert.deepEqual(errors, []);
  await mkdir(artifactsRoot, { recursive: true });
  const report = { recordedAt: new Date().toISOString(), browser: browser.version(), viewport: { width: 320, height: 240 }, iterations: 64, formulas: ids.length, errors, results, note: 'Policy/render smoke only; no CPU bit-identical oracle or frame-rate claim.' };
  await writeFile(`${artifactsRoot}/${output}.json`, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(`Saved ${ids.length} formula results: ${artifactsRoot}/${output}.json`);
} finally { if (browser) await browser.close(); server.kill(); }
