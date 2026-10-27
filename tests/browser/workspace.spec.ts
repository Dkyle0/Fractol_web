import { historyAction } from './helpers';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const scene = (page: Page) => page.evaluate(() => window.__FRACTOL__!.scene());
async function openBenchmark(page: Page) {
  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  await page.getByRole('radio', { name: /^Плавность/ }).check();
  await page.getByRole('button', { name: 'Бенчмарк', exact: true }).click();
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const messages: string[] = []; errors.set(page, messages);
  page.on('pageerror', e => messages.push(e.message));
  page.on('console', e => { if (/\[Vue warn\]|Failed to resolve/.test(e.text())) messages.push(e.text()); });
  await page.goto('/?debug=1'); await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { draws: number }).draws > 0);
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test('undo and redo group drag and wheel and branch on palette changes', async ({ page }) => {
  const initial = await scene(page), canvas = page.getByTestId('fractal-canvas');
  await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(760, 500, { steps: 8 }); await page.mouse.up();
  const moved = await scene(page); expect(moved.camera).not.toEqual(initial.camera);
  await historyAction(page); expect((await scene(page)).camera).toEqual(initial.camera);
  await canvas.focus(); await page.keyboard.press('Control+Shift+Z'); expect((await scene(page)).camera).toEqual(moved.camera);
  // Deliver a single wheel burst; separate automation round trips can exceed
  // the intentional 300 ms grouping window on a busy GPU/desktop.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    for (let i = 0; i < 2; i++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 700, clientY: 450, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(350);
  await canvas.focus(); await page.keyboard.press('Control+z'); expect((await scene(page)).camera).toEqual(moved.camera);
  await page.getByRole('button', { name: 'Палитра: Туманность', exact: true }).click();
  await page.getByRole('button', { name: 'Ещё', exact: true }).click(); await expect(page.getByRole('menuitem', { name: 'Повторить действие', exact: true })).toBeDisabled(); await page.keyboard.press('Escape');
  await historyAction(page); expect((await scene(page)).coloring).toEqual(moved.coloring);
});

test('Julia numeric edits and pointer session commit once; inputs keep native shortcuts', async ({ page }) => {
  await page.getByRole('button', { name: 'Открыть: Жюлиа', exact: true }).click(); const initial = await scene(page);
  const input = page.getByLabel('Действительная часть Julia'); await input.fill('0.2'); await input.fill('0.3'); await input.press('Enter');
  await historyAction(page); expect((await scene(page)).parameters).toEqual(initial.parameters);
  await page.getByRole('button', { name: 'Изменять указателем', exact: true }).click();
  await page.mouse.move(700, 420); await page.mouse.move(730, 450, { steps: 5 }); await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  expect((await scene(page)).parameters).not.toEqual(initial.parameters);
  await historyAction(page); expect((await scene(page)).parameters).toEqual(initial.parameters);
  await input.focus(); await input.press('Control+z'); expect((await scene(page)).fractalId).toBe('julia');
});

test('mobile history menu is reachable without overflowing and touch is one action', async ({ page, context, browserName }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('button', { name: 'Скрыть параметры', exact: true }).click();
  await expect(page.getByTestId('controls-panel')).toBeHidden();
  const initial = await scene(page);
  if (browserName === 'chromium') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 430 }] });
    for (const x of [170, 180, 190, 200]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 450 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
  } else { await page.mouse.move(160, 430); await page.mouse.down(); await page.mouse.move(200, 450, { steps: 4 }); await page.mouse.up(); }
  expect((await scene(page)).camera).not.toEqual(initial.camera);
  const menu = page.getByRole('button', { name: 'Ещё', exact: true }); const box = (await menu.boundingBox())!; expect(box.x + box.width).toBeLessThanOrEqual(320);
  await menu.click(); await page.getByText('Отменить действие', { exact: true }).click(); expect((await scene(page)).camera).toEqual(initial.camera);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('collection supports preview merge, idempotent reimport, rename, search, sort and JSON export', async ({ page }) => {
  const snapshot = await scene(page);
  const file = { name: 'collection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, favorites: ['julia'], scenes: [{ id: 'one', name: 'Первая', createdAt: '2026-10-18T12:00:00Z', scene: snapshot }, { id: 'two', name: 'Вторая', createdAt: '2026-10-17T12:00:00Z', scene: snapshot }, null] })) };
  await page.getByRole('button', { name: /^Моя коллекция/ }).click();
  await page.getByLabel('Файл коллекции').setInputFiles(file); await expect(page.getByText(/Новых сцен: 2 · Повторов: 0 · Некорректных записей: 1/)).toBeVisible();
  expect(await page.locator('.saved-list article').count()).toBe(0);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click(); await expect(page.locator('.saved-list article')).toHaveCount(2);
  await page.getByLabel('Файл коллекции').setInputFiles(file); await expect(page.getByText(/Новых сцен: 0 · Повторов: 2/)).toBeVisible(); await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('button', { name: 'Переименовать сцену: Первая', exact: true }).click(); await page.getByRole('textbox', { name: 'Новое название' }).fill('Моя долина'); await page.getByRole('button', { name: 'Применить название', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск в коллекции' }).fill('долина'); await expect(page.locator('.saved-list article')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Поиск в коллекции' }).fill(''); await page.getByLabel('Сортировка коллекции').selectOption('oldest'); await expect(page.locator('.saved-open').first()).toContainText('Вторая');
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Экспорт JSON', exact: true }).click(); const download = await downloaded;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8')); expect(exported.scenes).toHaveLength(2); expect(exported.favorites).toContain('julia');
  await page.getByLabel('Файл коллекции').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') }); await expect(page.getByRole('alert')).toContainText('JSON'); await expect(page.locator('.saved-list article')).toHaveCount(2);
});

test('manual preferences persist, startup stays Mandelbrot and dialogs restore focus', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Оформление', exact: true }); await opener.click();
  await page.getByRole('button', { name: 'Лёгкое стекло', exact: true }).click(); await page.getByRole('button', { name: 'Показать диагностику', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click(); await expect(opener).toBeFocused();
  await page.getByRole('button', { name: 'Открыть: Жюлиа', exact: true }).click(); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Мандельброт', exact: true })).toBeVisible(); await expect(page.locator('.laboratory')).toHaveClass(/light-glass/); await expect(page.getByTestId('diagnostics')).toHaveCount(0);
});

test('current-scene benchmark completes, restores history and exports editable Markdown with device data', async ({ page }) => {
  // The current-scene benchmark measures viewing previews only.
  test.setTimeout(90_000);
  await page.getByRole('button', { name: 'Палитра: Туманность', exact: true }).click(); const initial = await scene(page);
  await openBenchmark(page); await page.getByLabel('Текущая сцена', { exact: false }).check(); await page.getByRole('button', { name: 'Запустить бенчмарк', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Результаты', exact: true })).toBeVisible({ timeout: 80_000 });
  await expect(page.locator('.benchmark-profile')).toHaveText('Профиль: Плавность · fractol-navigation-v6-events');
  expect(await scene(page)).toEqual(initial); await expect(page.locator('.benchmark-results tbody tr')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Комментарий к результату' }).fill('Проверка от сети, стекло включено.'); await page.getByRole('textbox', { name: 'Модель устройства — вручную' }).fill('Тестовый ПК');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать .md', exact: true }).click(); const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^fractol-benchmark-.*\.md$/); const md = await readFile((await download.path())!, 'utf8');
  for (const expected of ['Проверка от сети', 'Тестовый ПК', 'User-Agent', 'GPU', '```json', 'fractol-navigation-v6-events', 'nebula']) expect(md).toContain(expected);
  expect(md).toContain('Режим ресурсов: standard; целевая частота 60 новых полей/с.');
  expect(md).toContain('фактические итерации 512');
  await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click(); await historyAction(page); expect((await scene(page)).coloring.palette).toBe('aurora');
  // The source viewing plan is ready and rendering remains idle after restore.
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as {viewing:{ready:boolean}}).viewing.ready);
  const draws = await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws); await page.waitForTimeout(350); expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws)).toBe(draws);
});

for (const reason of ['user', 'resize', 'hidden', 'context'] as const) test(`benchmark interrupts on ${reason} and restores the scene`, async ({ page }) => {
  const initial = await scene(page); await openBenchmark(page); await page.getByRole('button', { name: 'Запустить бенчмарк', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible(); await page.waitForTimeout(350);
  if (reason === 'user') await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  if (reason === 'resize') await page.setViewportSize({ width: 1000, height: 800 });
  if (reason === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  if (reason === 'context') await page.evaluate(() => { const canvas = document.querySelector('canvas')!; const ext = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!; ext.loseContext(); setTimeout(() => ext.restoreContext(), 100); });
  await expect(page.getByRole('heading', { name: 'Неполный прогон', exact: true })).toBeVisible(); expect(await scene(page)).toEqual(initial); await expect(page.getByRole('button', { name: 'Скачать .md', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { qualityProfile: string }).qualityProfile)).toBe('performance');
});
