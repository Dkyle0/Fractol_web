import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { FractalId } from '../../src/domain/types';
import { emulateTouchCapabilities } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }) => { await emulateTouchCapabilities(page, true); });

test('economy mode applies mobile rendering limits and survives reload', async ({ page }) => {
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.__FRACTOL__?.stats());
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as { resourceMode: string })).toMatchObject({ resourceMode: 'economy' });

  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  const standard = page.locator('input[name="resource-mode"][value="standard"]');
  await standard.locator('xpath=..').click();
  await expect(standard).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as { resourceMode: string; targetFps: number }))
    .toMatchObject({ resourceMode: 'standard', targetFps: 60 });
  const economy = page.locator('input[name="resource-mode"][value="economy"]');
  await economy.locator('xpath=..').click();
  await expect(economy).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as {
    resourceMode: string; targetFps: number; renderLimits: { maxDpr: number; maxPixels: number };
  })).toMatchObject({ resourceMode: 'economy', targetFps: 30, renderLimits: { maxDpr: 1, maxPixels: 600_000 } });

  await page.reload();
  await page.waitForFunction(() => window.__FRACTOL__?.stats());
  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  await expect(page.locator('input[name="resource-mode"][value="economy"]')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('economy viewing export is available separately from exact PNG', async ({ page }) => {
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.__FRACTOL__?.stats());

  await page.getByRole('button', { name: /Экспорт/ }).click();
  const viewing = page.locator('input[name="export-kind"][value="viewing"]');
  await expect(viewing).toBeChecked();
  await expect(page.getByRole('button', { name: 'Скачать PNG', exact: true })).toBeEnabled();
  await expect(page.locator('input[name="export-kind"][value="exact"]')).toBeVisible();
});

test('automatic mode follows touch capability, not a narrow desktop viewport', async ({ browser }) => {
  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const desktopContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: false });
  try {
    const touchPage = await touchContext.newPage(), desktopPage = await desktopContext.newPage();
    await emulateTouchCapabilities(touchPage, true); await emulateTouchCapabilities(desktopPage, false);
    await touchPage.goto('/?debug=1'); await desktopPage.goto('/?debug=1');
    await touchPage.waitForFunction(() => window.__FRACTOL__?.stats()); await desktopPage.waitForFunction(() => window.__FRACTOL__?.stats());
    await expect.poll(() => touchPage.evaluate(() => window.__FRACTOL__!.stats() as { resourceMode: string })).toMatchObject({ resourceMode: 'economy' });
    await expect.poll(() => desktopPage.evaluate(() => window.__FRACTOL__!.stats() as { resourceMode: string })).toMatchObject({ resourceMode: 'standard' });
  } finally { await touchContext.close(); await desktopContext.close(); }
});

test('viewing PNG downloads the ready preview without starting field computation', async ({ page }) => {
  await page.goto('/?debug=1'); await page.waitForFunction(() => window.__FRACTOL__?.stats());
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as { viewing: { ready: boolean } })).toMatchObject({ viewing: { ready: true } });
  const computations = await page.evaluate(() => (window.__FRACTOL__!.stats() as { computations: number }).computations);
  await page.getByRole('button', { name: /Экспорт/ }).click();
  await expect(page.locator('input[name="export-kind"][value="viewing"]')).toBeChecked();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  const download = await downloadPromise;
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { computations: number }).computations)).toBe(computations);
  const draws = await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws)).toBe(draws);
});

test('deep economy scene keeps its source camera for fast and exact PNG', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto('/?debug=1'); await page.waitForFunction(() => window.__FRACTOL__?.stats());
  await page.evaluate(() => {
    const scene = window.__FRACTOL__!.scene(); scene.camera = { x: 3, y: 3, height: 1e-10 }; scene.iterations = 64;
    window.__FRACTOL__!.setScene(scene);
  });
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as { viewing: { ready: boolean; overview: boolean } }))
    .toMatchObject({ viewing: { ready: true, overview: true } });
  const source = await page.evaluate(() => window.__FRACTOL__!.scene());
  const computations = await page.evaluate(() => (window.__FRACTOL__!.stats() as { computations: number }).computations);
  await page.getByRole('button', { name: /Экспорт/ }).click();
  await expect(page.locator('input[name="export-kind"][value="viewing"]')).toBeChecked();
  let downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  let download = await downloadPromise;
  expect((await readFile((await download.path())!)).subarray(1, 4).toString()).toBe('PNG');
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(source);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { computations: number }).computations)).toBe(computations);

  await page.getByRole('button', { name: /Экспорт/ }).click();
  await page.locator('input[name="export-kind"][value="exact"]').locator('xpath=..').click();
  await expect(page.getByRole('spinbutton', { name: 'Итерации экспорта', exact: true })).toHaveValue('64');
  downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  download = await downloadPromise;
  expect((await readFile((await download.path())!)).subarray(1, 4).toString()).toBe('PNG');
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(source);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { computations: number }).computations)).toBeGreaterThan(computations);
});

test('economy view returns after hidden tab and WebGL context restore, then stays idle', async ({ page }) => {
  await page.goto('/?debug=1'); await page.waitForFunction(() => window.__FRACTOL__?.stats());
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as { viewing: { ready: boolean } })).toMatchObject({ viewing: { ready: true } });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(250);
  const drawsWhileHidden = await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.evaluate(() => {
    const gl = document.querySelector('canvas')!.getContext('webgl2')!;
    const extension = gl.getExtension('WEBGL_lose_context')!; extension.loseContext(); setTimeout(() => extension.restoreContext(), 100);
  });
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }), { timeout: 15_000 }).toMatchObject({ viewing: { ready: true } });
  const readyDraws = await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws);
  expect(readyDraws).toBeGreaterThanOrEqual(drawsWhileHidden);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws)).toBe(readyDraws);
});

test('all fourteen formulae reach a ready economy preview', async ({ page }) => {
  test.setTimeout(120_000);
  const ids: FractalId[] = ['mandelbrot', 'julia', 'burning-ship', 'tricorn', 'multibrot', 'celtic', 'buffalo', 'perpendicular', 'legacy-ship', 'legacy-something', 'newton', 'nova', 'phoenix', 'magnet-1'];
  await page.goto('/?debug=1'); await page.waitForFunction(() => window.__FRACTOL__?.stats());
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as { viewing: { ready: boolean } })).toMatchObject({ viewing: { ready: true } });
  await page.evaluate(() => {
    const renderer = window.__FRACTOL__!.renderer() as unknown as { backend: { library: {
      doubleSingle: (...args: unknown[]) => unknown;
      prepare: (id: string, arithmetic?: string, ...args: unknown[]) => unknown;
    } } };
    const library = renderer.backend.library;
    const counts = { doubleSingle: 0, binary64Prepare: 0 };
    const originalDoubleSingle = library.doubleSingle;
    const originalPrepare = library.prepare;
    library.doubleSingle = function (...args: unknown[]) { counts.doubleSingle++; return originalDoubleSingle.apply(this, args); };
    library.prepare = function (id: string, arithmetic?: string, ...args: unknown[]) {
      if (arithmetic === 'binary64') counts.binary64Prepare++;
      return originalPrepare.call(this, id, arithmetic, ...args);
    };
    (window as unknown as { economyPreparationProbe: typeof counts }).economyPreparationProbe = counts;
  });
  for (const id of ids) {
    await page.evaluate(formula => window.__FRACTOL__!.select(formula), id);
    await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as { viewing: { ready: boolean }; resourceMode: string }), { timeout: 12_000 })
      .toMatchObject({ viewing: { ready: true }, resourceMode: 'economy' });
  }
  expect(await page.evaluate(() => (window as unknown as { economyPreparationProbe: { doubleSingle: number; binary64Prepare: number } }).economyPreparationProbe))
    .toEqual({ doubleSingle: 0, binary64Prepare: 0 });
});
