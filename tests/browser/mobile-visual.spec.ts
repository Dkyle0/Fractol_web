import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('captures economy settings and export dialogs at narrow, mobile, tablet and desktop widths', async ({ page }, testInfo) => {
  const visualDir = resolve(testInfo.outputDir, 'visual');
  await mkdir(visualDir, { recursive: true });
  await page.goto('/?debug=1'); await page.waitForFunction(() => window.__FRACTOL__?.stats());
  await page.evaluate(() => window.__FRACTOL__!.select('julia'));
  await page.waitForFunction(() => window.__FRACTOL__!.scene().fractalId === 'julia' && (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready);
  for (const width of [320, 390, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Оформление', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Оформление и качество', exact: true });
    await expect(dialog).toBeVisible();
    const standard = dialog.locator('input[name="resource-mode"][value="standard"]');
    await standard.locator('xpath=..').click();
    await expect(standard).toBeChecked();
    await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { resourceMode: string; viewing: { ready: boolean } })))
      .toMatchObject({ resourceMode: 'standard', viewing: { ready: true } });
    await dialog.locator('.dialog-card').evaluate((element: HTMLElement) => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('visual', `settings-full-${width}.png`) });
    const economy = dialog.locator('input[name="resource-mode"][value="economy"]');
    await economy.locator('xpath=..').click();
    await expect(economy).toBeChecked();
    await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { resourceMode: string; viewing: { ready: boolean } })))
      .toMatchObject({ resourceMode: 'economy', viewing: { ready: true } });
    await page.waitForTimeout(300);
    await dialog.locator('.dialog-card').evaluate((element: HTMLElement) => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('visual', `settings-${width}.png`) });
    if (width === 320) {
      const card = dialog.locator('.dialog-card');
      const dimensions = await card.evaluate((element: HTMLElement) => ({ height: element.clientHeight, scrollHeight: element.scrollHeight }));
      expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.height);
      await card.evaluate((element: HTMLElement) => { element.scrollTop = element.scrollHeight; });
      await expect(dialog.getByRole('button', { name: 'Закрыть диалог', exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('visual', 'settings-320-bottom.png') });
      await card.evaluate((element: HTMLElement) => { element.scrollTop = 0; });
    }
    await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: /Экспорт/ }).click();
    await expect(page.getByRole('dialog', { name: 'Сохранить изображение', exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    await page.getByRole('dialog', { name: 'Сохранить изображение', exact: true }).locator('.dialog-card').evaluate((element: HTMLElement) => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('visual', `export-${width}.png`) });
    await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
    await page.waitForTimeout(300);
  }
});
