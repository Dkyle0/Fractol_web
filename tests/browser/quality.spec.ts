import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { GpuMeasurement } from '../../src/domain/quality';
const scene = (page: Page) => page.evaluate(() => window.__FRACTOL__!.scene());
async function settings(page: Page) { await page.getByRole('button', { name: 'Оформление', exact: true }).click(); }
const profiles = (page: Page) => page.getByRole('group', { name: 'Профиль качества', exact: true });
async function choose(page: Page, name: string) { await profiles(page).getByRole('radio', { name: new RegExp(`^${name}`) }).check(); }
const runtime = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; runtime.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes('[Vue warn]')) errors.push(message.text()); });
  await page.goto('/?debug=1'); await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { draws: number }).draws > 0);
});
test.afterEach(({ page }) => expect(runtime.get(page)).toEqual([]));
test('profiles persist separately from scene and history and old preferences migrate', async ({ page }) => {
  // Includes three cold page/context loads and a separate gesture; this is a
  // persistence regression, not the hardware navigation benchmark.
  test.setTimeout(120000);
  const initial = await scene(page);
  await settings(page);
  await profiles(page).getByRole('radio', { name: /^Авто/ }).focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: /^Плавность/ })).toBeChecked();
  await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  expect(await scene(page)).toEqual(initial);
  await page.reload(); await settings(page); await expect(page.getByRole('radio', { name: /^Плавность/ })).toBeChecked();
  await choose(page, 'Качество'); await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  const result = await page.evaluate(async () => {
    const api = window.__FRACTOL__!; const sizes: { width: number; height: number }[] = [];
    const renderer = api.renderer() as { resize: (w: number, h: number) => void }, resize = renderer.resize;
    renderer.resize = function(w, h) { sizes.push({ width: w, height: h }); return resize.call(this, w, h); };
    try { for (let i = 0; i < 35; i++) { api.pan(.2, 0); await new Promise(requestAnimationFrame); } }
    finally { renderer.resize = resize; }
    return { sizes, stats: api.stats() as { qualityProfile: string; width: number; height: number; scale: number } };
  });
  expect(result.stats).toMatchObject({ qualityProfile: 'quality', scale: 1 });
  expect(result.sizes.length).toBeGreaterThan(0);
  expect(result.sizes.every(s => s.width === result.stats.width && s.height === result.stats.height)).toBe(true);
  await page.getByTestId('fractal-canvas').focus(); await page.keyboard.press('Control+z');
  expect((await scene(page)).camera).toEqual(initial.camera);
  await page.evaluate(() => localStorage.setItem('fractol.preferences.v1', JSON.stringify({ version: 1, lightGlass: true, diagnostics: false })));
  await page.reload(); await settings(page);
  await expect(profiles(page).getByRole('radio', { name: /^Авто/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Лёгкое стекло', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
test('performance caps moving framebuffer, restores full resolution and exports final-size PNG', async ({ page }) => {
  await settings(page); await choose(page, 'Плавность'); await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  const scales = await page.evaluate(async () => {
    const api = window.__FRACTOL__!, scales: number[] = [];
    for (let i = 0; i < 35; i++) { api.pan(.2, 0); await new Promise(requestAnimationFrame); scales.push((api.stats() as { scale: number }).scale); }
    return scales;
  });
  expect(scales.some(s => s < 1)).toBe(true); expect(scales.filter(s => s < 1).every(s => s >= .35 && s <= .75)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { scale: number }).scale)).toBe(1);
  const finalSize = await page.evaluate(() => { const s = window.__FRACTOL__!.stats() as { width: number; height: number }; return { width: s.width, height: s.height }; });
  await page.getByRole('button', { name: 'Экспорт PNG', exact: true }).click();
  await page.getByRole('button', { name: /Текущий размер/ }).click();
  // Emulate a reduced preview still present when export is requested.
  // The PNG size must come from the viewport budget, not this framebuffer.
  await page.evaluate(() => (window.__FRACTOL__!.renderer() as { resize: (w: number, h: number) => void }).resize(320, 200));
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  const bytes = await readFile((await (await pending).path())!);
  expect(bytes.readUInt32BE(16)).toBe(finalSize.width); expect(bytes.readUInt32BE(20)).toBe(finalSize.height);
});
for (const mode of ['standard', 'current'] as const) test(`${mode} benchmark selects and restores the profile after interruption`, async ({ page }) => {
  await settings(page); await choose(page, 'Качество'); await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  const before = await scene(page);
  const pending = page.evaluate(mode => window.__FRACTOL__!.benchmark(mode), mode);
  await expect(page.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible();
  await expect(page.locator('.topbar')).toHaveAttribute('inert', '');
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { qualityProfile: string }).qualityProfile)).toBe(mode === 'standard' ? 'auto' : 'quality');
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  const report = await pending;
  expect(report?.qualityProfile).toBe(mode === 'standard' ? 'auto' : 'quality');
  expect(await scene(page)).toEqual(before);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { qualityProfile: string }).qualityProfile)).toBe('quality');
  await expect(page.locator('.benchmark-profile')).toHaveText(`Профиль: ${mode === 'standard' ? 'Авто' : 'Качество'} · ${report?.method}`);
});
test('GPU queries retain submission size, reject disjoint and cache capabilities', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/src/rendering/renderer.ts', { FractalRenderer } = await import(path);
    const renderer = new FractalRenderer(document.createElement('canvas')), gl: WebGL2RenderingContext = renderer.getContext();
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!timer) { renderer.dispose(); return null; }
    let available = false, disjoint = false, capabilityReads = 0, allocations = 0;
    const samples: GpuMeasurement[] = [], unsubscribe = renderer.subscribeMeasurements((sample: GpuMeasurement) => samples.push(sample));
    const getParameter = gl.getParameter.bind(gl), getQuery = gl.getQueryParameter.bind(gl), image = gl.texImage2D.bind(gl);
    gl.getParameter = p => {
      if (p === timer.GPU_DISJOINT_EXT) return disjoint;
      if (p === gl.MAX_TEXTURE_SIZE) capabilityReads++;
      return getParameter(p);
    };
    gl.getQueryParameter = (q, p) => p === gl.QUERY_RESULT_AVAILABLE ? available : p === gl.QUERY_RESULT ? 2_000_000 : getQuery(q, p);
    gl.texImage2D = ((...args: Parameters<typeof gl.texImage2D>) => { allocations++; return image(...args); }) as typeof gl.texImage2D;
    try {
      const scene = window.__FRACTOL__!.scene(); await renderer.prepare(scene.fractalId);
      const caps = renderer.getCapabilities(); caps.maxTextureSize = 0;
      renderer.resize(64, 64); renderer.draw(scene);
      renderer.resize(32, 32); available = true; renderer.draw(scene);
      const sample = { ...renderer.stats.gpuSample }, id = renderer.stats.gpuSampleId;
      renderer.resize(32, 32); disjoint = true; renderer.draw(scene);
      return { sample, id, samples, afterId: renderer.stats.gpuSampleId, after: renderer.stats.gpuSample, ms: renderer.stats.gpuMs, capabilityReads, allocations, maxTexture: renderer.getCapabilities().maxTextureSize };
    } finally { unsubscribe(); renderer.dispose(); }
  });
  test.skip(result === null, 'GPU timer extension is unavailable; deterministic freshness tests still run');
  expect(result).toMatchObject({ sample: { width: 64, height: 64, ms: 2, kind: 'color' }, after: null, ms: null, capabilityReads: 0, allocations: 2 });
  expect(result!.samples.map(sample => sample.kind)).toEqual(['preview', 'color']);
  expect(result!.samples.every(sample => sample.width === 64 && sample.height === 64 && sample.ms === 2)).toBe(true);
  expect(result!.samples[1]!.id).toBeGreaterThan(result!.samples[0]!.id);
  expect(result!.sample.id).toBe(result!.samples[1]!.id); expect(result!.id).toBe(result!.sample.id); expect(result!.afterId).toBe(result!.id);
  expect(result!.sample.submittedAt).toBeGreaterThanOrEqual(0); expect(result!.maxTexture).toBeGreaterThan(0);
});
test('benchmark preparation error restores the selected profile and scene', async ({ page }) => {
  await settings(page); await choose(page, 'Плавность'); await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  const initial = await scene(page);
  const report = await page.evaluate(async () => {
    const api = window.__FRACTOL__!, renderer = api.renderer() as { prepare: () => Promise<void> }, prepare = renderer.prepare;
    renderer.prepare = () => Promise.reject(new Error('Test preparation failure'));
    try { return await api.benchmark('standard'); } finally { renderer.prepare = prepare; }
  });
  expect(report?.reason).toContain('Test preparation failure');
  expect(await scene(page)).toEqual(initial);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { qualityProfile: string }).qualityProfile)).toBe('performance');
  await expect(page.locator('.bottom-bar')).not.toHaveAttribute('inert');
});
