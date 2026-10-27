import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('current economy benchmark reports v6 resource metadata and restores the scene', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.__FRACTOL__?.stats());
  // Select explicitly: a touch-sized viewport is not a mobile-capability hint.
  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  await page.getByRole('group', { name: 'Режим ресурсов', exact: true }).getByRole('radio', { name: 'Экономный', exact: true }).check();
  await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as { resourceMode: string; viewing: { ready: boolean } }))
    .toMatchObject({ resourceMode: 'economy', viewing: { ready: true } });
  const source = await page.evaluate(() => window.__FRACTOL__!.scene());
  const report = await page.evaluate(() => window.__FRACTOL__!.benchmark('current', true));
  expect(report).toMatchObject({
    method: 'fractol-navigation-v6-events', mode: 'current', resourceMode: 'economy',
    targetFps: 30, renderLimits: { maxDpr: 1, maxPixels: 600_000 }, status: 'completed',
  });
  expect(report?.results).toHaveLength(2);
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(source);
  expect(await page.evaluate(() => window.__FRACTOL__!.stats() as { resourceMode: string })).toMatchObject({ resourceMode: 'economy' });
  await writeFile(testInfo.outputPath('mobile-benchmark.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
});
