import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('convergence-visual');
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [], shots = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir(`${artifactsRoot}/v1.3`, { recursive: true });
  await page.goto('http://127.0.0.1:5173/?debug=1');
  await page.waitForFunction(() => window.__FRACTOL__?.stats()?.draws > 0);
  // A contact sheet of all twelve presets, produced by the actual GPU kernels.
  const sheet = await page.evaluate(async () => {
    const { createScene, getFractal } = await import('/src/domain/catalog.ts');
    const { FractalRenderer } = await import('/src/rendering/renderer.ts');
    const renderer = new FractalRenderer(document.createElement('canvas'));
    const sheet = document.createElement('canvas'); sheet.width = 1600; sheet.height = 876;
    const context = sheet.getContext('2d'); context.fillStyle = '#101923'; context.fillRect(0, 0, sheet.width, sheet.height);
    try {
      for (const [column, id] of ['newton', 'nova', 'phoenix', 'magnet-1'].entries()) for (let row = 0; row < 3; row++) {
        const scene = createScene(id, row); if (id === 'newton') scene.coloring.palette = 'spectrum';
        const bitmap = await createImageBitmap(await renderer.export(scene, 400, 260));
        context.drawImage(bitmap, column * 400, row * 292); bitmap.close();
        context.fillStyle = '#def0eb'; context.font = '14px sans-serif'; context.fillText(`${getFractal(id).name}: ${getFractal(id).presets[row].name}`, column * 400 + 10, row * 292 + 280);
      }
    } finally { renderer.dispose(); }
    return sheet.toDataURL('image/png').split(',')[1];
  });
  await writeFile(`${artifactsRoot}/v1.3/presets.png`, Buffer.from(sheet, 'base64'));
  for (const width of [320, 390, 900, 1440]) for (const light of [false, true]) for (const id of ['newton', 'nova', 'phoenix', 'magnet-1']) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('http://127.0.0.1:5173/?debug=1'); await page.waitForFunction(() => window.__FRACTOL__?.stats()?.draws > 0);
    await page.evaluate(({ id, light }) => { window.__FRACTOL__.select(id); window.__FRACTOL__.glass(!light); }, { id, light });
    if (width < 1280) await page.getByRole('button', { name: 'Параметры', exact: true }).click();
    await expect(page.getByTestId('controls-panel')).toBeVisible();
    await page.waitForFunction(id => window.__FRACTOL__.stats()?.fractalId === id, id);
    await page.waitForTimeout(240);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const input of await page.getByRole('spinbutton').all()) {
      const box = await input.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      await input.focus(); await expect(input).toBeFocused();
    }
    const path = `${artifactsRoot}/v1.3/${id}-${width}-${light ? 'light' : 'glass'}.png`;
    await page.screenshot({ path, animations: 'disabled' }); shots.push(path);
  }
  expect(errors).toEqual([]);
  await writeFile(`${artifactsRoot}/v1.3/visual.json`, JSON.stringify({ recordedAt: new Date().toISOString(), browser: browser.version(), errors, shots }, null, 2));
  console.log(`Verified ${shots.length} views plus twelve GPU-rendered presets.`);
} finally { await browser.close(); }
