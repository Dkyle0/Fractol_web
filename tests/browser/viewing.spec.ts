import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function watchBinary64Passes(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const probe = { passes: 0 };
    (window as unknown as { binary64ViewingProbe: typeof probe }).binary64ViewingProbe = probe;
    const prototype = WebGL2RenderingContext.prototype, original = prototype.drawArrays, programs = new WeakMap<WebGLProgram, boolean>();
    prototype.drawArrays = function (...args: Parameters<typeof original>) {
      const program = this.getParameter(this.CURRENT_PROGRAM) as WebGLProgram | null;
      if (program) {
        if (!programs.has(program)) programs.set(program, (this.getAttachedShaders(program) ?? []).some(shader => (this.getShaderSource(shader) ?? '').includes('uvec2 r[')));
        if (programs.get(program)) probe.passes++;
      }
      return original.apply(this, args);
    };
  });
}

test('deep linked scene stays an overview until explicit adoption and uses binary64 only for PNG', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 640, height: 480 });
  await page.goto('/?debug=1');
  console.log('viewing checkpoint: initial route', page.url());
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { draws: number }).draws > 0);
  console.log('viewing checkpoint: initial frame');
  if (await page.getByTestId('catalog-panel').isVisible()) await page.getByRole('button', { name: 'Каталог фракталов', exact: true }).click();
  await watchBinary64Passes(page);

  const requested = await page.evaluate(() => {
    const scene = window.__FRACTOL__!.scene(); scene.camera = { x: 3, y: 3, height: 1e-10 }; scene.iterations = 64;
    window.__FRACTOL__!.setScene(scene); return scene;
  });
  await page.waitForFunction(() => {
    const viewing = (window.__FRACTOL__!.stats() as { viewing: { ready: boolean; overview: boolean } }).viewing;
    return viewing.ready && viewing.overview;
  });
  console.log('viewing checkpoint: deep overview ready');
  await expect(page.getByTestId('overview-notice')).toBeVisible();
  await expect(page.getByTestId('source-region')).toBeVisible();
  const view = await page.evaluate(() => (window.__FRACTOL__!.stats() as { phase: string; timeUntilPreciseMs: number | null; viewing: { camera: { x: number; y: number; height: number }; arithmetic: string; effectiveIterations: number; ready: boolean } }));
  expect(view.phase).toBe('preview'); expect(view.timeUntilPreciseMs).toBeNull();
  expect(view.viewing).toMatchObject({ arithmetic: 'double-single', effectiveIterations: 64, ready: true });
  expect(view.viewing.camera.height).toBeGreaterThan(requested.camera.height);
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(requested);
  await expect(page.getByRole('button', { name: 'Сбросить камеру', exact: true })).toBeDisabled();
  const controlsReset = page.getByRole('button', { name: 'Вернуться к общему виду', exact: true });
  if (await controlsReset.count()) await expect(controlsReset).toBeDisabled();
  await page.getByTestId('fractal-canvas').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(requested);
  expect(await page.evaluate(() => (window as unknown as { binary64ViewingProbe: { passes: number } }).binary64ViewingProbe.passes)).toBe(0);

  await page.getByRole('button', { name: 'Поделиться сценой', exact: true }).click();
  await expect(page).toHaveURL(/#scene=/);
  console.log('viewing checkpoint: share updated URL', page.url());
  const deepLink = page.url();
  expect(JSON.parse(decodeURIComponent(new URL(deepLink).hash.slice('#scene='.length)))).toEqual(requested);
  await page.getByTestId('adopt-overview').click();
  console.log('viewing checkpoint: adopted');
  const adopted = await page.evaluate(() => window.__FRACTOL__!.scene());
  expect(adopted.camera).toEqual(view.viewing.camera);
  await page.getByTestId('fractal-canvas').focus(); await page.keyboard.press('Control+z');
  expect((await page.evaluate(() => window.__FRACTOL__!.scene())).camera).toEqual(requested.camera);

  await page.goto(deepLink);
  console.log('viewing checkpoint: reopened deep URL', page.url());
  await watchBinary64Passes(page);
  if (await page.getByTestId('catalog-panel').isVisible()) await page.getByRole('button', { name: 'Каталог фракталов', exact: true }).click();
  await page.waitForFunction(() => {
    const viewing = (window.__FRACTOL__!.stats() as { viewing: { ready: boolean; overview: boolean } }).viewing;
    return viewing.ready && viewing.overview;
  });
  console.log('viewing checkpoint: reopened overview ready');
  await expect(page.getByTestId('source-region')).toBeVisible();
  await page.getByRole('button', { name: /Экспорт (исходного кадра|PNG)/ }).click();
  await page.getByRole('button', { name: /Текущий размер/ }).click();
  const downloadPromise = page.waitForEvent('download');
  console.log('viewing checkpoint: PNG selected');
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  console.log('viewing checkpoint: PNG download triggered');
  const download = await downloadPromise, bytes = await readFile((await download.path())!);
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(0); expect(bytes.readUInt32BE(20)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { binary64ViewingProbe: { passes: number } }).binary64ViewingProbe.passes)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(requested);
});

test('motion and settled viewing keep the selected 2000 iterations', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 240 }); await page.goto('/?debug=1');
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { draws: number }).draws > 0);
  await page.evaluate(() => { const scene = window.__FRACTOL__!.scene(); scene.iterations = 2000; window.__FRACTOL__!.setScene(scene); });
  const canvas = page.getByTestId('fractal-canvas'), box = await canvas.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + box!.height / 2 + 15, { steps: 2 });
  await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { viewing: { effectiveIterations: number } }).viewing.effectiveIterations)).toBe(2000);
  await page.mouse.up();
  await page.waitForFunction(() => { const s = window.__FRACTOL__!.stats() as { viewing: { effectiveIterations: number; ready: boolean; arithmetic: string } }; return s.viewing.ready && s.viewing.effectiveIterations === 2000 && s.viewing.arithmetic === 'float32'; }, undefined, { timeout: 10_000 });
});

test('safe 2000 iteration viewing uses float32 while a deep camera uses double-single', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 240 }); await page.goto('/?debug=1');
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { draws: number }).draws > 0);
  await page.evaluate(() => { const scene = window.__FRACTOL__!.scene(); scene.iterations = 2000; scene.camera = { x: 0, y: 0, height: 1 }; window.__FRACTOL__!.setScene(scene); });
  await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean; effectiveIterations: number; arithmetic: string } }).viewing)).toMatchObject({ ready: true, effectiveIterations: 2000, arithmetic: 'float32' });
  await page.evaluate(() => { const scene = window.__FRACTOL__!.scene(); scene.camera = { x: 3, y: 3, height: 1e-6 }; window.__FRACTOL__!.setScene(scene); });
  await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean; effectiveIterations: number; arithmetic: string } }).viewing)).toMatchObject({ ready: true, effectiveIterations: 2000, arithmetic: 'double-single' });
});

test('PNG iteration field validates its range, keeps the source scene, and caches by iteration count', async ({ page }) => {
  test.setTimeout(120_000); await page.setViewportSize({ width: 320, height: 240 });
  await page.addInitScript(() => {
    const probe = { passes: 0 };
    (window as unknown as { binary64ViewingProbe: typeof probe }).binary64ViewingProbe = probe;
    const prototype = WebGL2RenderingContext.prototype, original = prototype.drawArrays, programs = new WeakMap<WebGLProgram, boolean>();
    prototype.drawArrays = function (...args: Parameters<typeof original>) {
      const program = this.getParameter(this.CURRENT_PROGRAM) as WebGLProgram | null;
      if (program) {
        if (!programs.has(program)) programs.set(program, (this.getAttachedShaders(program) ?? []).some(shader => (this.getShaderSource(shader) ?? '').includes('uvec2 r[')));
        if (programs.get(program)) probe.passes++;
      }
      return original.apply(this, args);
    };
  });
  await page.goto('/?debug=1'); await page.waitForFunction(() => window.__FRACTOL__?.stats());
  await page.evaluate(() => { const scene = window.__FRACTOL__!.scene(); scene.camera = { x: 3, y: 3, height: .1 }; scene.iterations = 64; window.__FRACTOL__!.setScene(scene); });
  await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready)).toBe(true);
  const source = await page.evaluate(() => window.__FRACTOL__!.scene());
  const openExport = async () => { await page.locator('.export-button').click(); await page.locator('.export-options button').nth(1).click(); };
  const input = page.getByRole('spinbutton', { name: 'Итерации экспорта', exact: true });
  await openExport(); await expect(input).toHaveValue('64');
  await expect(input).toHaveAttribute('min', '64'); await expect(input).toHaveAttribute('max', '16384');
  await input.fill('2000'); await expect(input).toHaveValue('2000');
  await input.fill('64'); await input.press('Enter'); await expect(input).toHaveValue('64');
  await input.fill('16385'); await expect(input).toHaveAttribute('aria-invalid', 'true'); await input.press('Enter'); await expect(input).toHaveValue('64');
  const exportAt = async (iterations: number) => {
    if (iterations !== 64) { await input.fill(String(iterations)); await input.press('Enter'); await expect(input).toHaveValue(String(iterations)); }
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
    const download = await pending; const bytes = await readFile((await download.path())!); expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    await expect(page.locator('.dialog-card')).toBeHidden({ timeout: 30_000 });
  };
  await exportAt(64);
  const first = await page.evaluate(() => (window as unknown as { binary64ViewingProbe: { passes: number } }).binary64ViewingProbe.passes);
  expect(first).toBeGreaterThan(0);
  await openExport(); await exportAt(3584);
  const second = await page.evaluate(() => (window as unknown as { binary64ViewingProbe: { passes: number } }).binary64ViewingProbe.passes);
  expect(second).toBeGreaterThan(first);
  await openExport(); await exportAt(3584);
  expect(await page.evaluate(() => (window as unknown as { binary64ViewingProbe: { passes: number } }).binary64ViewingProbe.passes)).toBe(second);
  await openExport(); await exportAt(16384);
  expect(await page.evaluate(() => (window as unknown as { binary64ViewingProbe: { passes: number } }).binary64ViewingProbe.passes)).toBeGreaterThan(second);
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(source);
});
