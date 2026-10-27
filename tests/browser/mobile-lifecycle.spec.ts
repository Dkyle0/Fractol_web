import { expect, test, type Page } from '@playwright/test';
import { historyAction } from './helpers';

type Scene = ReturnType<NonNullable<Window['__FRACTOL__']>['scene']>;
type Stats = { computations: number; draws: number; resourceMode: string; targetFps: number; renderLimits: { maxDpr: number; maxPixels: number }; viewing: { ready: boolean; effectiveIterations: number; arithmetic: string; overview: boolean } };

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function openEconomy(page: Page) {
  await page.addInitScript(() => localStorage.setItem('fractol.preferences.v1', JSON.stringify({
    version: 1, lightGlass: false, diagnostics: true, qualityProfile: 'auto', resourceMode: 'economy',
  })));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => (window.__FRACTOL__?.stats() as { draws?: number } | undefined)?.draws! > 0);
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as Stats)).toMatchObject({
    resourceMode: 'economy', targetFps: 30, renderLimits: { maxDpr: 1, maxPixels: 600_000 },
  });
}

async function waitForReady(page: Page) {
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as Stats).viewing.ready, null, { timeout: 20_000 });
}

async function holdNextPng(page: Page) {
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.toBlob;
    let pending: { canvas: HTMLCanvasElement; callback: BlobCallback; args: [string?, number?] } | undefined;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (!pending && args[0] === 'image/png') { pending = { canvas: this, callback, args }; return; }
      native.call(this, callback, ...args);
    };
    (window as Window & { __mobilePng?: { held: () => boolean; release: () => void } }).__mobilePng = {
      held: () => !!pending,
      release: () => {
        if (!pending) throw new Error('PNG encoder is not held');
        const current = pending; pending = undefined;
        native.call(current.canvas, current.callback, ...current.args);
      },
    };
  });
}

async function releaseHeldPng(page: Page) {
  await page.evaluate(() => {
    const probe = (window as Window & { __mobilePng?: { held: () => boolean; release: () => void } }).__mobilePng;
    if (probe?.held()) probe.release();
  });
}

async function sceneVariants(page: Page) {
  return page.evaluate(() => {
    const a = window.__FRACTOL__!.scene();
    const b = structuredClone(a); b.fractalId = 'julia'; b.camera = { ...b.camera, x: b.camera.x + 0.25 };
    const c = structuredClone(a); c.fractalId = 'burning-ship'; c.camera = { ...c.camera, x: c.camera.x - 0.4, y: c.camera.y + 0.1 };
    return { a, b, c };
  });
}

async function navigateToLatestHash(page: Page, b: Scene, c: Scene) {
  await page.evaluate(([nextB, nextC]) => {
    location.hash = `#scene=${encodeURIComponent(JSON.stringify(nextB))}`;
    location.hash = `#scene=${encodeURIComponent(JSON.stringify(nextC))}`;
  }, [b, c]);
  await expect.poll(() => page.evaluate(() => location.hash)).toContain(encodeURIComponent(JSON.stringify(c)));
}

test('touch drag and pinch preserve economy limits and remain undoable actions', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP touch injection is Chromium-specific.');
  await openEconomy(page); await waitForReady(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const catalog = page.getByRole('button', { name: 'Каталог фракталов', exact: true });
  if (await catalog.getAttribute('aria-expanded') === 'true') await catalog.click();
  const parameters = page.getByRole('button', { name: 'Параметры', exact: true });
  if (await parameters.getAttribute('aria-expanded') === 'true') await parameters.click();
  const x = 160, y = 300;
  const cdp = await context.newCDPSession(page);
  const initial = await page.evaluate(() => window.__FRACTOL__!.scene());
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 20, y: y + 10, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 36, y: y + 24, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene().camera)).not.toEqual(initial.camera);
    const dragged = await page.evaluate(() => window.__FRACTOL__!.scene());

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 45, y, id: 1 }, { x: x + 45, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 60, y, id: 1 }, { x: x + 60, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 75, y, id: 1 }, { x: x + 75, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene().camera)).not.toEqual(dragged.camera);
    await page.keyboard.press('f');
    await historyAction(page);
    await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene().camera)).toEqual(dragged.camera);
    await historyAction(page);
    await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene().camera)).toEqual(initial.camera);
    await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as Stats)).toMatchObject({
      resourceMode: 'economy', targetFps: 30, renderLimits: { maxDpr: 1, maxPixels: 600_000 },
    });
  } finally { await cdp.detach(); }
});

test('rotation keeps the 2000-iteration source while economy preview stays at 512 within policy limits', async ({ page }) => {
  await openEconomy(page);
  const source = await page.evaluate(() => {
    const scene = window.__FRACTOL__!.scene(); scene.iterations = 2000; scene.camera = { x: 3, y: 3, height: 1e-10 };
    window.__FRACTOL__!.setScene(scene); return window.__FRACTOL__!.scene();
  });
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as Stats), { timeout: 20_000 }).toMatchObject({
    resourceMode: 'economy', targetFps: 30, renderLimits: { maxDpr: 1, maxPixels: 600_000 },
    viewing: { ready: true, effectiveIterations: 512, arithmetic: 'float32', overview: true },
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => dispatchEvent(new Event('orientationchange')));
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as Stats), { timeout: 20_000 }).toMatchObject({
    resourceMode: 'economy', targetFps: 30, renderLimits: { maxDpr: 1, maxPixels: 600_000 },
    viewing: { ready: true, effectiveIterations: 512, arithmetic: 'float32', overview: true },
  });
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(source);
});

test('setting 512 from an economy overview changes the scene once and one undo restores N=2000', async ({ page }) => {
  await openEconomy(page);
  const source = await page.evaluate(() => {
    const scene = window.__FRACTOL__!.scene(); scene.iterations = 2000; scene.camera = { x: 3, y: 3, height: 1e-10 };
    window.__FRACTOL__!.setScene(scene); return window.__FRACTOL__!.scene();
  });
  await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await page.getByTestId('controls-panel').waitFor({ state: 'visible' });
  const set512 = page.getByRole('button', { name: 'Установить 512', exact: true });
  await expect(set512).toBeVisible(); await set512.click();
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene().iterations)).toBe(512);
  await historyAction(page);
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(source);
});

test('manual glass preference survives economy mode and returns in standard mode', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fractol.preferences.v1', JSON.stringify({
    version: 1, lightGlass: false, diagnostics: true, qualityProfile: 'auto', resourceMode: 'standard',
  })));
  await page.goto('/?debug=1'); await page.waitForFunction(() => window.__FRACTOL__?.stats());
  const settings = page.getByRole('button', { name: 'Оформление', exact: true }); await settings.click();
  const glass = page.getByRole('button', { name: 'Лёгкое стекло', exact: true });
  await glass.click(); await expect(glass).toHaveAttribute('aria-pressed', 'true');
  const economy = page.locator('input[name="resource-mode"][value="economy"]');
  await economy.locator('xpath=..').click(); await expect(economy).toBeChecked();
  const standard = page.locator('input[name="resource-mode"][value="standard"]');
  await standard.locator('xpath=..').click(); await expect(standard).toBeChecked();
  await expect(glass).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fractol.preferences.v1')!).lightGlass)).toBe(true);
});

test('cancelling held fast PNG creates no download, preserves the scene and returns to idle', async ({ page }) => {
  await holdNextPng(page); await openEconomy(page); await waitForReady(page);
  const source = await page.evaluate(() => window.__FRACTOL__!.scene());
  const before = await page.evaluate(() => window.__FRACTOL__!.stats() as Stats);
  await page.getByRole('button', { name: /Экспорт/ }).click();
  await expect(page.locator('input[name="export-kind"][value="viewing"]')).toBeChecked();
  const download = page.waitForEvent('download', { timeout: 3_000 }).then(() => true, () => false);
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  await page.waitForFunction(() => (window as Window & { __mobilePng?: { held: () => boolean } }).__mobilePng?.held());
  await page.getByRole('button', { name: 'Отменить экспорт', exact: true }).click();
  await releaseHeldPng(page);
  expect(await download).toBe(false);
  await expect(page.getByRole('button', { name: 'Скачать PNG', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(source);
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.stats() as Stats)).toMatchObject({ computations: before.computations, resourceMode: 'economy', viewing: { ready: true } });
  const draws = await page.evaluate(() => (window.__FRACTOL__!.stats() as Stats).draws);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as Stats).draws)).toBe(draws);
});

test('latest hash wins and stays undoable while the fast PNG encoder is held', async ({ page }) => {
  await holdNextPng(page); await openEconomy(page); await waitForReady(page);
  const { a, b, c } = await sceneVariants(page);
  await page.getByRole('button', { name: /Экспорт/ }).click();
  const download = page.waitForEvent('download', { timeout: 3_000 }).then(() => true, () => false);
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  await page.waitForFunction(() => (window as Window & { __mobilePng?: { held: () => boolean } }).__mobilePng?.held());
  await navigateToLatestHash(page, b, c);
  await releaseHeldPng(page);
  expect(await download).toBe(false);
  await expect(page.locator('.dialog-card')).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(c);
  await historyAction(page);
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(a);
});
