import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('economy mode restores from preferences and downloads the ready viewing PNG without recomputation', async ({ page }) => {
  test.setTimeout(30_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('fractol.preferences.v1', JSON.stringify({
      version: 1, lightGlass: false, diagnostics: false, qualityProfile: 'auto', resourceMode: 'economy',
    }));
  });
  const waitReady = async () => {
    await page.waitForFunction(() => window.__FRACTOL__?.stats());
    await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as {
      resourceMode: string; targetFps: number; renderLimits: { maxDpr: number; maxPixels: number };
      viewing: { ready: boolean; effectiveIterations: number; arithmetic: string };
    })).toMatchObject({ resourceMode: 'economy', targetFps: 30,
      renderLimits: { maxDpr: 1, maxPixels: 600_000 },
      viewing: { ready: true, effectiveIterations: 512, arithmetic: 'float32' } });
  };

  await page.goto('/?debug=1'); await waitReady();
  const scene = await page.evaluate(() => window.__FRACTOL__!.scene());
  const computations = await page.evaluate(() => (window.__FRACTOL__!.stats() as { computations: number }).computations);
  await page.getByRole('button', { name: /Экспорт/ }).click();
  await expect(page.locator('input[name="export-kind"][value="viewing"]')).toBeChecked();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  const download = await downloadPromise;
  expect((await readFile((await download.path())!)).subarray(1, 4).toString()).toBe('PNG');
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(scene);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { computations: number }).computations)).toBe(computations);
  const draws = await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws)).toBe(draws);

  await page.reload(); await waitReady();
});
