import { expect, test, type Page } from '@playwright/test';
import { historyAction } from './helpers';
const snapshot = (page: Page) => page.evaluate(() => window.__FRACTOL__!.scene());
const runtime = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; runtime.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes('[Vue warn]')) errors.push(message.text()); });
  await page.goto('/?debug=1'); await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { draws: number }).draws > 0);
});
test.afterEach(({ page }) => expect(runtime.get(page)).toEqual([]));

test('right-edge disclosure stays findable and restores keyboard focus', async ({ page }) => {
  const before = await snapshot(page), close = page.getByRole('button', { name: 'Скрыть параметры', exact: true });
  await expect(page.getByRole('heading', { name: 'Параметры', exact: true })).toBeVisible();
  await close.click();
  const open = page.getByRole('button', { name: 'Параметры', exact: true });
  await expect(open).toBeFocused(); await expect(open).toHaveAttribute('aria-expanded', 'false');
  const box = (await open.boundingBox())!; expect(box.x).toBeGreaterThan(1000);
  await open.press('Enter'); await expect(close).toBeFocused(); await expect(close).toHaveAttribute('aria-expanded', 'true');
  await close.press('Space'); await expect(open).toBeFocused();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('.navigation').getByRole('button', { name: /Отменить|Повторить/ })).toHaveCount(0);
});

test('clean view preserves navigation, panel choices, scene and history without fullscreen', async ({ page }) => {
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click(); const zoomed = await snapshot(page);
  await page.getByRole('button', { name: 'Скрыть интерфейс', exact: true }).click();
  await expect(page.locator('.topbar')).toBeHidden(); await expect(page.getByTestId('diagnostics')).toBeHidden();
  await expect(page.getByTestId('catalog-panel')).toBeHidden(); await expect(page.getByTestId('controls-panel')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Навигация по фракталу' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Показать интерфейс', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull(); expect(await snapshot(page)).toEqual(zoomed);
  await page.getByTestId('fractal-canvas').focus(); await page.keyboard.press('f');
  await expect(page.getByTestId('catalog-panel')).toBeVisible(); await expect(page.getByTestId('controls-panel')).toBeVisible();
  await historyAction(page); expect((await snapshot(page)).camera).toEqual(before.camera);
  await page.getByTestId('fractal-canvas').focus(); await page.keyboard.press('f'); await page.keyboard.press('Escape'); await expect(page.locator('.topbar')).toBeVisible();
});

test('opening remembered panels exits clean view and explicitly opens the requested panel', async ({ page }) => {
  for (const target of ['Параметры', 'Каталог фракталов']) {
    await page.getByRole('button', { name: 'Скрыть интерфейс', exact: true }).click();
    await page.getByRole('button', { name: target, exact: true }).click();
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.getByTestId(target === 'Параметры' ? 'controls-panel' : 'catalog-panel')).toBeVisible();
  }
});

test('Escape closes a menu before clean view and menu arrows do not pan the canvas', async ({ page }) => {
  await page.getByRole('button', { name: 'Скрыть интерфейс', exact: true }).click();
  const before = await snapshot(page), more = page.getByRole('button', { name: 'Ещё', exact: true });
  await more.click(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu', { name: 'Ещё', exact: true })).toBeHidden(); await expect(more).toBeFocused();
  await expect(page.getByRole('button', { name: 'Показать интерфейс', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Скрыть интерфейс', exact: true })).toBeVisible();
});

test('resize preserves the last-selected panel and does not reopen closed panels', async ({ page }) => {
  await page.getByRole('button', { name: 'Каталог фракталов', exact: true }).click();
  await page.getByRole('button', { name: 'Каталог фракталов', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByTestId('catalog-panel')).toBeVisible(); await expect(page.getByTestId('controls-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await expect(page.getByTestId('catalog-panel')).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(page.getByTestId('catalog-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Скрыть параметры', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByTestId('controls-panel')).toBeHidden();
});

for (const width of [320, 390, 900, 1440]) test(`navigation labels and targets fit both modes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  for (const minimal of [false, true]) {
    if (minimal) await page.getByRole('button', { name: 'Скрыть интерфейс', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Навигация по фракталу' });
    const bounds = (await nav.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    const buttons = await nav.getByRole('button').all();
    const boxes = [];
    for (const button of buttons) {
      if (!await button.isVisible()) continue;
      const box = (await button.boundingBox())!; boxes.push(box);
      expect(box.x).toBeGreaterThanOrEqual(bounds.x); expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
      expect(await button.locator('.v-btn__content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1).toBe(false);
    }
    if (width < 768) { expect(bounds.height).toBe(104); await expect(nav.getByRole('button', { name: 'Параметры', exact: true })).toBeVisible(); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('benchmark locks layout actions and restores clean view and Escape priority', async ({ page }) => {
  await page.getByRole('button', { name: 'Скрыть интерфейс', exact: true }).click(); const before = await snapshot(page);
  const report = page.evaluate(() => window.__FRACTOL__!.benchmark('current'));
  await expect(page.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible();
  await expect(page.locator('.bottom-bar')).toHaveAttribute('inert', '');
  await page.keyboard.press('f'); await expect(page.locator('.laboratory')).not.toHaveClass(/immersive/);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click(); await report;
  await expect(page.getByRole('heading', { name: 'Неполный прогон', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.laboratory')).toHaveClass(/immersive/); expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press('Escape'); await expect(page.getByTestId('controls-panel')).toBeVisible(); await expect(page.getByTestId('catalog-panel')).toBeVisible();
});
