import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = []; runtimeErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  const consoleErrors: string[] = [], requestFailures: string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`));
  await page.goto('/?debug=1');
  try {
    await page.waitForFunction(() => ((window.__FRACTOL__?.stats() as { draws?: number })?.draws ?? 0) > 0);
  } catch (error) {
    const initialState = await page.evaluate(() => ({ readyState: document.readyState, title: document.title,
      text: document.body.innerText.slice(0, 2000), hasDiagnostics: Boolean(window.__FRACTOL__),
      stats: window.__FRACTOL__?.stats(), canvas: [...document.querySelectorAll('canvas')].map(canvas => ({ width: canvas.width, height: canvas.height })) }));
    await testInfo.attach('initial-page-diagnostics.json', { body: JSON.stringify({ consoleErrors, requestFailures, pageErrors: errors, initialState }, null, 2), contentType: 'application/json' });
    throw error;
  }
  await expect(page.getByRole('heading', { name: 'Мандельброт', exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

test('loads a complete desktop and sleeps when idle; coloring reuses computation', async ({ page }, testInfo) => {
  await expect(page.getByRole('button', { name: /^Открыть:/ })).toHaveCount(14);
  await expect(page.getByTestId('controls-panel')).toBeVisible();
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready);
  const before = await page.evaluate(() => window.__FRACTOL__!.stats() as { draws: number; computations: number });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws)).toBe(before.draws);
  await page.getByRole('button', { name: 'Палитра: Туманность', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws)).toBeGreaterThan(before.draws);
  expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { computations: number }).computations)).toBe(before.computations);
  await page.getByRole('button', { name: 'Палитра: Аврора', exact: true }).click();
  await page.getByRole('button', { name: 'Оформление' }).click();
  await page.getByRole('button', { name: 'Показать диагностику', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  await page.waitForTimeout(250);
  await expect(page.locator('.card-name').first()).toBeVisible();
  expect(await page.locator('.card-category').first().evaluate(el => el.getBoundingClientRect().bottom <= el.closest('article')!.getBoundingClientRect().bottom)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  const images = await page.locator('.thumbnail img').evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0));
  expect(images).toBe(true);
});

test('catalog, formula controls, favorites and presets', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Найти фрактал' }).fill('Жюлиа');
  await expect(page.getByRole('button', { name: /^Открыть:/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'В избранное: Жюлиа', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть: Жюлиа', exact: true }).click();
  await page.getByLabel('Действительная часть Julia').fill('-0.8');
  expect(await page.evaluate(() => window.__FRACTOL__!.scene().parameters.juliaRe)).toBe(-.8);
  await page.getByRole('button', { name: 'Спиральная галактика', exact: true }).click();
  expect(await page.evaluate(() => window.__FRACTOL__!.scene().parameters.juliaIm)).toBe(.156);
  await page.getByRole('textbox', { name: 'Найти фрактал' }).fill('');
  await page.getByRole('button', { name: 'Избранное', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Открыть:/ })).toHaveCount(1);
  await page.reload();
  await page.waitForFunction(() => window.__FRACTOL__);
  await expect(page.getByRole('button', { name: 'Убрать из избранного: Жюлиа', exact: true })).toBeVisible();
});

test('camera navigation anchors wheel, keyboard avoids inputs and resets', async ({ page }) => {
  const before = await page.evaluate(() => window.__FRACTOL__!.scene().camera);
  await page.mouse.move(720, 480); await page.mouse.wheel(0, -200);
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene().camera.height)).toBeLessThan(before.height);
  await page.mouse.move(720, 500); await page.mouse.down(); await page.mouse.move(780, 530, { steps: 5 }); await page.mouse.up();
  expect(await page.evaluate(() => window.__FRACTOL__!.scene().camera.x)).not.toBe(before.x);
  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene().camera)).toEqual(before);
  await page.getByRole('textbox', { name: 'Найти фрактал' }).focus(); await page.keyboard.press('+');
  expect(await page.evaluate(() => window.__FRACTOL__!.scene().camera)).toEqual(before);
  await page.getByRole('textbox', { name: 'Найти фрактал' }).fill('');
  await page.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
  await page.getByRole('button', { name: 'Сбросить камеру', exact: true }).click();
  expect(await page.evaluate(() => window.__FRACTOL__!.scene().camera)).toEqual(before);
  await page.getByRole('button', { name: 'Ещё', exact: true }).click(); await page.getByRole('menuitemcheckbox', { name: 'Перемещение по кнопкам', exact: true }).click();
  await page.getByRole('button', { name: 'Сдвинуть вид влево', exact: true }).click();
  expect((await page.evaluate(() => window.__FRACTOL__!.scene().camera)).x).toBeLessThan(before.x);
});

test('named scenes persist and URL scenes reproduce camera and color', async ({ page }) => {
  // This workflow creates several cold GPU contexts. Navigation performance
  // has separate hardware criteria; keep every persistence/link assertion.
  test.setTimeout(120000);
  await page.getByRole('button', { name: 'Открыть: Жюлиа', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название сцены' }).fill('Моя спираль');
  await page.getByRole('button', { name: 'Сохранить сцену', exact: true }).click();
  const scene = await page.evaluate(() => window.__FRACTOL__!.scene());
  await page.reload(); await page.waitForFunction(() => window.__FRACTOL__);
  await page.getByRole('button', { name: /Моя коллекция/ }).click();
  await page.getByRole('button', { name: /^Моя спираль/ }).click();
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(scene);
  await page.getByRole('button', { name: 'Поделиться сценой', exact: true }).click();
  await expect(page).toHaveURL(/#scene=/);
  const hash = '#scene=' + encodeURIComponent(JSON.stringify(scene));
  await page.goto('/' + hash); await page.waitForFunction(() => window.__FRACTOL__);
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(scene);
  await page.goto('/?invalid=1#scene=%ZZ');
  await page.waitForTimeout(4600); // Startup warnings must survive expensive initial preparation.
  await expect(page.getByText('Ссылка не распознана. Открыта стартовая сцена.')).toBeVisible();
});

test('exports a valid Full HD PNG', async ({ page }) => {
  await page.getByRole('button', { name: 'Экспорт PNG', exact: true }).click();
  await page.getByRole('button', { name: /Full HD/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  const result = await download, file = await result.path();
  expect(result.suggestedFilename()).toBe('fractol-mandelbrot.png');
  const bytes = await readFile(file!);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.readUInt32BE(16)).toBe(1920); expect(bytes.readUInt32BE(20)).toBe(1080);
});

test('recovers a lost WebGL context without losing the scene', async ({ page }) => {
  const scene = await page.evaluate(() => window.__FRACTOL__!.scene());
  const supported = await page.evaluate(() => {
    const renderer = window.__FRACTOL__!.renderer() as { getContext(): WebGL2RenderingContext };
    const extension = renderer.getContext().getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext(); setTimeout(() => extension.restoreContext(), 250); return true;
  });
  test.skip(!supported, 'WEBGL_lose_context unavailable');
  await expect(page.getByText('Восстанавливаем изображение', { exact: true })).toBeVisible();
  await expect(page.getByText('Восстанавливаем изображение', { exact: true })).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number })?.draws ?? 0)).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(scene);
});

test('all GPU formulas agree with independent CPU samples', async ({ page }) => {
  const failures = await page.evaluate(async () => {
    const rendererPath = '/src/rendering/renderer.ts', referencePath = '/src/domain/reference.ts', catalogPath = '/src/domain/catalog.ts';
    const { FractalRenderer } = await import(rendererPath), { escapePoint } = await import(referencePath), { fractals, createScene } = await import(catalogPath);
    const renderer = new FractalRenderer(document.createElement('canvas')), failures: string[] = [];
    try {
      for (const fractal of fractals.filter((f: { shaderKind: number }) => f.shaderKind <= 9)) {
        const scene = createScene(fractal.id); scene.camera = { x: 0, y: 0, height: 8 };
        await renderer.prepare(fractal.id); renderer.resize(128, 128); renderer.draw(scene);
        for (const [x, y] of [[64, 64], [115, 115], [20, 32], [56, 70], [75, 50], [32, 64]]) {
          const cpu = escapePoint(fractal.id, (x + .5 - 64) * 8 / 128, (y + .5 - 64) * 8 / 128, scene.iterations, scene.parameters);
          const gpu = renderer.readPoint(x, y);
          if (cpu.escaped !== gpu.escaped || (cpu.escaped && Math.abs(cpu.value - gpu.value) > .1)) failures.push(`${fractal.id} (${x},${y}): cpu=${JSON.stringify(cpu)} gpu=${JSON.stringify(gpu)}`);
        }
      }
    } finally {
      const gl = renderer.getContext(), active = gl.getParameter(gl.CURRENT_PROGRAM);
      renderer.dispose();
      if (active && gl.isProgram(active)) failures.push('GPU program was not released');
    }
    return failures;
  });
  expect(failures).toEqual([]);
});

test('mobile panels are exclusive, resize preserves scene, and touch pans and pinches', async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload(); await page.waitForFunction(() => window.__FRACTOL__);
  await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await expect(page.getByTestId('catalog-panel')).toBeHidden(); await expect(page.getByTestId('controls-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть параметры', exact: true }).click();
  const before = await page.evaluate(() => window.__FRACTOL__!.scene().camera);
  await page.waitForTimeout(250);
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 300, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 320, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y: 300, id: 1 }, { x: 240, y: 300, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 140, y: 300, id: 1 }, { x: 280, y: 300, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(160, 300); await page.mouse.down(); await page.mouse.move(180, 320); await page.mouse.up();
    await page.mouse.wheel(0, -200);
  }
  const after = await page.evaluate(() => window.__FRACTOL__!.scene().camera);
  expect(after.x).not.toBe(before.x); expect(after.height).toBeLessThan(before.height);
  await page.getByRole('button', { name: 'Каталог фракталов', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Открыть мою коллекцию', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Моя коллекция/ })).toBeVisible();
});

test('a retina viewport obeys the pixel budget and preserves its scene on resize', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:5173/?debug=1');
    await page.waitForFunction(() => ((window.__FRACTOL__?.stats() as { draws?: number })?.draws ?? 0) > 0);
    const stats = await page.evaluate(() => window.__FRACTOL__!.stats() as { width: number; height: number });
    expect(stats.width * stats.height).toBeLessThanOrEqual(3_000_000);
    const scene = await page.evaluate(() => window.__FRACTOL__!.scene());
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { width: number }).width)).not.toBe(stats.width);
    expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(scene);
  } finally { await context.close(); }
});

test('rapid formula changes render the latest requested scene', async ({ page }) => {
  await page.evaluate(async () => {
    for (const id of ['julia', 'multibrot', 'legacy-something', 'celtic', 'buffalo', 'tricorn'] as const) {
      window.__FRACTOL__!.select(id); await new Promise(resolve => setTimeout(resolve, 8));
    }
  });
  await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { fractalId: string }).fractalId)).toBe('tricorn');
  await expect(page.getByText('Подготавливаем фрактал…', { exact: true })).toBeHidden();
});

test('reports unavailable WebGL without breaking the catalog', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: function(this: HTMLCanvasElement, ...args: unknown[]) {
      return args[0] === 'webgl2' ? null : Reflect.apply(original, this, args);
    } });
  });
  await page.reload();
  await expect(page.getByText('Изображение недоступно', { exact: true })).toBeVisible();
  await expect(page.getByText('WebGL2 недоступен. Проверьте аппаратное ускорение и обновите браузер.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Открыть:/ })).toHaveCount(14);
  await page.getByRole('button', { name: 'Открыть: Жюлиа', exact: true }).click();
  await expect(page.getByText('Изображение недоступно', { exact: true })).toBeVisible();
});

test('handles damaged storage and reports a refused write', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('fractol.library.v1', '{broken'));
  await page.reload();
  await expect(page.getByText('Не удалось прочитать сохранения. Текущая сцена продолжит работать.')).toBeVisible();
  await page.waitForTimeout(4600);
  await expect(page.getByText('Не удалось прочитать сохранения. Текущая сцена продолжит работать.')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть уведомление', exact: true }).click();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить сцену', exact: true }).click();
  await expect(page.getByText('Браузер не сохранил коллекцию. Скопируйте ссылку на сцену.')).toBeVisible();
});
