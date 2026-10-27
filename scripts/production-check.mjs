import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('production-check');
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output=process.env.PRODUCTION_OUTPUT||'production-smoke-v1.4';
if(!/^[a-z0-9._-]+$/i.test(output))throw new Error('Invalid PRODUCTION_OUTPUT');
try { await access(`${artifactsRoot}/${output}.json`); throw new Error('Output exists; choose a new PRODUCTION_OUTPUT'); }
catch(error) { if(error.code!=='ENOENT')throw error; }
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { windowsHide: true, stdio: 'pipe' });
let browser;
let serverOutput = ''; server.stdout.on('data', data => { serverOutput += data; }); server.stderr.on('data', data => { serverOutput += data; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode != null) throw new Error(serverOutput);
    try { ready = (await fetch('http://127.0.0.1:4173/')).ok; } catch { /* Server starts asynchronously. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'Production preview did not start.');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(180_000);
  const errors = [], externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('data:')) externalRequests.push(request.url()); });
  await page.goto('http://127.0.0.1:4173/?debug=1');
  await page.waitForFunction(() => window.__FRACTOL__?.stats()?.draws > 0);
  assert.equal(await page.title(), 'Fractol — пространство бесконечности');
  await page.getByRole('button', { name: 'Палитра: Туманность', exact: true }).click();
  await page.waitForFunction(() => window.__FRACTOL__?.scene().coloring.palette === 'nebula');
  const formulas = ['newton', 'nova', 'phoenix', 'magnet-1'];
  for (const id of formulas) {
    await page.evaluate(id => window.__FRACTOL__.select(id), id);
    await page.waitForFunction(id => window.__FRACTOL__.stats()?.fractalId === id, id);
    assert.equal(await page.evaluate(() => window.__FRACTOL__.scene().coloring.palette), 'nebula');
  }
  await page.getByRole('button', { name: 'Палитра: Спектр', exact: true }).click();
  // Production correctness smoke is separate from expensive full-scene throughput.
  // The new kernels are checked above; exercise the bundled precise PNG on Mandelbrot.
  await page.evaluate(() => window.__FRACTOL__.select('mandelbrot'));
  await page.waitForFunction(() => window.__FRACTOL__.scene().fractalId === 'mandelbrot');
  await page.getByRole('button', { name: 'Экспорт PNG', exact: true }).click();
  await page.getByRole('button', { name: /Full HD/ }).click();
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  const download = await pendingDownload, bytes = await readFile(await download.path());
  assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1080);
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  const stats = await page.evaluate(() => window.__FRACTOL__.stats());
  await mkdir(artifactsRoot, { recursive: true });
  await writeFile(`${artifactsRoot}/${output}.json`, JSON.stringify({ recordedAt: new Date().toISOString(), browser: browser.version(), formulas, errors, externalRequests, png: { width: 1920, height: 1080, bytes: bytes.length }, stats }, null, 2),{flag:'wx'});
  console.log('Production smoke passed: GPU render, local assets, palette, Full HD PNG; no runtime errors or external requests.');
} finally { if (browser) await browser.close(); server.kill(); }
