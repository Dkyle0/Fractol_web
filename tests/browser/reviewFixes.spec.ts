import { expect, test, type Page } from '@playwright/test';
import type { FieldUpdate } from '../../src/rendering/backend';

type Scene = ReturnType<NonNullable<Window['__FRACTOL__']>['scene']>;

const waitForApp = async (page: Page) => {
  await page.goto('/?debug=1');
  await page.waitForFunction(() => ((window.__FRACTOL__?.stats() as { draws?: number } | undefined)?.draws ?? 0) > 0);
};

const makeScenes = async (page: Page) => page.evaluate(() => {
  const a = window.__FRACTOL__!.scene();
  a.fractalId = 'mandelbrot'; a.camera = { x: 3, y: 3, height: .1 }; a.iterations = 64;
  window.__FRACTOL__!.setScene(a);
  const sceneA = window.__FRACTOL__!.scene();
  const sceneB = structuredClone(sceneA); sceneB.fractalId = 'julia'; sceneB.camera = { x: 3.25, y: -3, height: .1 };
  const sceneC = structuredClone(sceneA); sceneC.fractalId = 'burning-ship'; sceneC.camera = { x: -2.1, y: .15, height: .1 };
  return { sceneA, sceneB, sceneC };
});

const setLatestHash = async (page: Page, sceneB: Scene, sceneC: Scene) => {
  await page.evaluate(([b, c]) => {
    location.hash = `#scene=${encodeURIComponent(JSON.stringify(b))}`;
    location.hash = `#scene=${encodeURIComponent(JSON.stringify(c))}`;
  }, [sceneB, sceneC]);
  await expect.poll(() => page.evaluate(() => location.hash)).toContain(encodeURIComponent(JSON.stringify(sceneC)));
};

const expectLatestSceneAndUndo = async (page: Page, sceneC: Scene, sceneA: Scene) => {
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(sceneC);
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Отменить действие', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(sceneA);
};

test('latest hash wins during benchmark and remains undoable', async ({ page }) => {
  await waitForApp(page);
  const { sceneA, sceneB, sceneC } = await makeScenes(page);
  await page.setViewportSize({ width: 320, height: 240 });
  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  await page.getByRole('button', { name: 'Бенчмарк', exact: true }).click();
  await page.locator('input[name="benchmark-mode"][value="current"]').check({ force: true });
  await page.getByRole('button', { name: 'Запустить бенчмарк', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Остановить', exact: true });
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await setLatestHash(page, sceneB, sceneC);
  await expect(stop).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('.dialog-card')).toBeHidden({ timeout: 30_000 });
  await expectLatestSceneAndUndo(page, sceneC, sceneA);
  const saveOpener = page.getByRole('button', { name: 'Сохранить', exact: true });
  await saveOpener.click();
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
  await expect(saveOpener).toBeFocused({ timeout: 5_000 });
});

test('latest hash wins while PNG encoding is pending and remains undoable', async ({ page }) => {
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.toBlob;
    let pending: { canvas: HTMLCanvasElement; callback: BlobCallback; args: [string?, number?] } | undefined;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (!pending && args[0] === 'image/png') { pending = { canvas: this, callback, args }; return; }
      native.call(this, callback, ...args);
    };
    (window as Window & { __reviewPng?: { held: () => boolean; release: () => void } }).__reviewPng = {
      held: () => !!pending,
      release: () => {
        if (!pending) throw new Error('PNG encoding is not being held');
        const current = pending; pending = undefined;
        native.call(current.canvas, current.callback, ...current.args);
      },
    };
  });
  await waitForApp(page);
  const { sceneA, sceneB, sceneC } = await makeScenes(page);
  await page.setViewportSize({ width: 320, height: 240 });
  await page.getByRole('button', { name: 'Экспорт PNG', exact: true }).click();
  const download = page.waitForEvent('download', { timeout: 5_000 }).then(() => true, () => false);
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  await page.waitForFunction(() => (window as Window & { __reviewPng?: { held: () => boolean } }).__reviewPng?.held());
  await setLatestHash(page, sceneB, sceneC);
  await page.evaluate(() => (window as Window & { __reviewPng?: { release: () => void } }).__reviewPng!.release());
  await expect(page.locator('.dialog-card')).toBeHidden({ timeout: 30_000 });
  expect(await download).toBe(false);
  await expectLatestSceneAndUndo(page, sceneC, sceneA);
});

test('each shared dialog state exposes a non-empty accessible name', async ({ page }) => {
  await waitForApp(page);
  const expectNamedDialog = async () => {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.ariaSnapshot()).toMatch(/dialog\s+"[^"\n]+"/);
  };
  const close = async () => page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();

  await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expectNamedDialog(); await close();
  await page.getByRole('button', { name: 'Моя коллекция', exact: true }).click(); await expectNamedDialog(); await close();
  await page.getByRole('button', { name: 'Экспорт PNG', exact: true }).click(); await expectNamedDialog(); await close();
  await page.getByRole('button', { name: 'О приложении и управлении', exact: true }).click(); await expectNamedDialog(); await close();
  await page.getByRole('button', { name: 'Оформление', exact: true }).click(); await expectNamedDialog();
  await page.getByRole('button', { name: 'Бенчмарк', exact: true }).click(); await expectNamedDialog();
});

test('GPU timer queries bracket computation before the independent color pass', async ({ page }) => {
  await waitForApp(page);
  const events = await page.evaluate(() => {
    const diagnostics = window.__FRACTOL__!.renderer() as unknown as {
      backend: {
        draw: (scene: unknown) => void;
        measurements: { begin: (source: { kind: string }) => boolean; end: (active: boolean) => void };
      };
      getContext: () => WebGL2RenderingContext;
    };
    const backend = diagnostics.backend, gl = diagnostics.getContext(), measurements = backend.measurements;
    const originalBegin = measurements.begin, originalEnd = measurements.end, originalDraw = gl.drawArrays;
    const log: string[] = [];
    measurements.begin = function(source) { const active = originalBegin.call(this, source); log.push(`begin:${source.kind}:${active}`); return active; };
    measurements.end = function(active) { log.push(`end:${active}`); return originalEnd.call(this, active); };
    gl.drawArrays = function(...args: Parameters<WebGL2RenderingContext['drawArrays']>) { log.push('draw'); return originalDraw.apply(this, args); };
    try {
      const scene = window.__FRACTOL__!.scene(); scene.camera.x += .125;
      backend.draw(scene);
      return log;
    } finally { measurements.begin = originalBegin; measurements.end = originalEnd; gl.drawArrays = originalDraw; }
  });
  const computeBegin = events.findIndex(event => event.startsWith('begin:preview:'));
  const computeEnd = events.findIndex((event,index) => index > computeBegin && event.startsWith('end:'));
  const colorBegin = events.findIndex((event,index) => index > computeEnd && event.startsWith('begin:color:'));
  const draws = events.flatMap((event, index) => event === 'draw' ? [index] : []);
  expect(computeBegin).toBeGreaterThanOrEqual(0); expect(colorBegin).toBeGreaterThan(computeBegin);
  expect(draws.length).toBeGreaterThanOrEqual(2);
  expect(draws[0]).toBeGreaterThan(computeBegin); expect(computeEnd).toBeGreaterThan(draws[0]);
  expect(draws[1]).toBeGreaterThan(colorBegin);
});

test('shader preparation yields cannot present a hidden surface', async ({ page }) => {
  await waitForApp(page);
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready);
  const result = await page.evaluate(async () => {
    const diagnostics = window.__FRACTOL__!.renderer() as unknown as {
      backend: { stats: { draws: number }; compilationDelay: () => Promise<void> };
    };
    const backend = diagnostics.backend;
    // Exercise the real preparation-yield callback without depending on a
    // driver's cold compiler timing or availability of the parallel extension.
    const before = backend.stats.draws;
    await backend.compilationDelay();
    const visible = backend.stats.draws;
    const previous = Object.getOwnPropertyDescriptor(document, 'hidden');
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    let hiddenBefore = 0, hiddenAfter = 0;
    try {
      setHidden(true);
      hiddenBefore = backend.stats.draws;
      for (let i = 0; i < 3; i++) await backend.compilationDelay();
      hiddenAfter = backend.stats.draws;
    } finally {
      if (previous) Object.defineProperty(document, 'hidden', previous);
      else Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    }
    const resumedBefore = backend.stats.draws;
    await backend.compilationDelay();
    return { before, visible, hiddenBefore, hiddenAfter, resumedBefore, resumed: backend.stats.draws };
  });
  expect(result.visible).toBeGreaterThan(result.before);
  expect(result.hiddenAfter).toBe(result.hiddenBefore);
  expect(result.resumed).toBeGreaterThan(result.resumedBefore);
});

test('terminal preview error stays visible through recoloring and clears after successful new math', async ({ page }) => {
  await waitForApp(page);
  await page.evaluate(() => {
    const diagnostics = window.__FRACTOL__!.renderer() as unknown as { backend: { preview: (request: unknown) => unknown } };
    const backend = diagnostics.backend, original = backend.preview;
    (window as Window & { __reviewPreviewCalls?: number; __reviewOriginalPreview?: typeof original }).__reviewPreviewCalls = 0;
    (window as Window & { __reviewOriginalPreview?: typeof original }).__reviewOriginalPreview = original;
    backend.preview = function(this: unknown, request: unknown) {
      const target = window as Window & { __reviewPreviewCalls?: number };
      target.__reviewPreviewCalls = (target.__reviewPreviewCalls ?? 0) + 1;
      if (target.__reviewPreviewCalls === 1) return Promise.reject(new Error('review preview failure'));
      return Reflect.apply(original, this, [request]);
    };
    const scene = window.__FRACTOL__!.scene(); scene.camera = { x: 3, y: 3, height: .1 }; scene.iterations = 64;
    window.__FRACTOL__!.setScene(scene);
  });
  const failure = page.getByText('review preview failure', { exact: true });
  await failure.waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as Window & { __reviewPreviewCalls?: number }).__reviewPreviewCalls)).toBe(1);

  const appliedPhase = await page.evaluate(() => {
    const scene = window.__FRACTOL__!.scene(); scene.coloring.phase += .15; window.__FRACTOL__!.setScene(scene);
    return window.__FRACTOL__!.scene().coloring.phase;
  });
  expect(appliedPhase).toBe(.15);
  await page.waitForTimeout(100);
  expect(await failure.isVisible()).toBe(true);
  expect(await page.evaluate(() => (window as Window & { __reviewPreviewCalls?: number }).__reviewPreviewCalls)).toBe(1);

  await page.evaluate(() => {
    const scene = window.__FRACTOL__!.scene(); scene.camera.x += .01; window.__FRACTOL__!.setScene(scene);
  });
  await page.waitForFunction(() => (window as Window & { __reviewPreviewCalls?: number }).__reviewPreviewCalls === 2, undefined, { timeout: 10_000 });
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready, undefined, { timeout: 10_000 });
  await expect(failure).toBeHidden();
  await page.evaluate(() => {
    const diagnostics = window.__FRACTOL__!.renderer() as unknown as { backend: { preview: (request: unknown) => unknown } };
    diagnostics.backend.preview = (window as Window & { __reviewOriginalPreview?: (request: unknown) => unknown }).__reviewOriginalPreview!;
  });
});

for (const iterations of [64, 512, 3584]) test(`tiled field publish at ${iterations} iterations does not color the completed field twice`, async ({ page }) => {
  await waitForApp(page);
  await page.setViewportSize({ width: 100, height: 100 });
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready);
  const result = await page.evaluate(async iterations => {
    const diagnostics = window.__FRACTOL__!.renderer() as unknown as {
      backend: { present: (scene: unknown, kind?: string) => void; subscribeFields: (listener: (update: FieldUpdate) => void) => () => void };
    };
    const backend = diagnostics.backend, original = backend.present;
    const kinds: string[] = [];
    const publishedTiles: string[] = []; let completions = 0;
    const unsubscribe = backend.subscribeFields(update => {
      if (update.tile) publishedTiles.push(JSON.stringify([update.job.id, update.tile]));
      if (update.complete) completions++;
    });
    backend.present = function (scene, kind) { kinds.push(kind ?? 'repeat'); return original.call(this, scene, kind); };
    try {
      const scene = window.__FRACTOL__!.scene();
      scene.fractalId = 'mandelbrot'; scene.camera = { x: 3, y: 3, height: 1e-5 }; scene.iterations = iterations;
      const before = (window.__FRACTOL__!.stats() as { computations: number }).computations;
      window.__FRACTOL__!.setScene(scene);
      await new Promise<void>(resolve => {
        const check = () => {
          const stats = window.__FRACTOL__!.stats() as { computations: number; viewing: { ready: boolean; camera: { height: number } } };
          if (stats.computations > before && stats.viewing.ready && stats.viewing.camera.height === 1e-5) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
      await new Promise(resolve => setTimeout(resolve, 50));
      return { kinds, publishedTiles, completions };
    } finally { unsubscribe(); backend.present = original; }
  }, iterations);
  // A retina viewport can span several tiles. Each is presented once; the
  // completion notification must not add a second full-field color pass.
  expect(result.publishedTiles.length).toBeGreaterThan(0);
  expect(new Set(result.publishedTiles).size).toBe(result.publishedTiles.length);
  expect(result.completions).toBe(1);
  expect(result.kinds.filter(kind => kind === 'computed')).toHaveLength(result.publishedTiles.length);
});
