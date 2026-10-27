import { test, expect } from '@playwright/test';
import { historyAction } from './helpers';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/?debug=1');
  await page.waitForFunction(() => (window.__FRACTOL__?.stats() as { draws: number })?.draws > 0);
});

test('new kernels agree with independent CPU outcomes, roots and convergence scalars', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/rendering/renderer.ts', referencePath = '/src/domain/reference.ts', catalogPath = '/src/domain/catalog.ts';
    const { FractalRenderer } = await import(rendererPath), { evaluatePoint } = await import(referencePath), { createScene } = await import(catalogPath);
    const renderer = new FractalRenderer(document.createElement('canvas')), failures: string[] = [];
    let samples = 0;
    try {
      renderer.resize(1, 1);
      for (const id of ['newton', 'nova', 'phoenix', 'magnet-1']) {
        const degrees = id === 'newton' ? [3, 4, 5, 6, 7, 8] : [3];
        for (const degree of degrees) for (let preset = 0; preset < 3; preset++) {
          const scene = createScene(id, preset); scene.parameters.power = degree;
          await renderer.prepare(id);
          const points = id === 'newton' ? [[0, 0], [1, 0], [1.01, 0], [.6, .4], [-.4, .7], [3, 1]] : id === 'nova' ? [[0, 0], [-1, 0], [.1, .1], [-.1, .2], [.5, 1], [3, 1]] : id === 'phoenix' ? [[0, 0], [3, 3], [.7, .3], [-.4, .6]] : [[2, 0], [1, 0], [2.01, 0], [3, 1], [-1, .5], [0, 0]];
          if (id === 'newton') for (let root = 0; root < degree; root++) points.push([Math.cos(2 * Math.PI * root / degree), Math.sin(2 * Math.PI * root / degree)]);
          for (const [px, py] of points) {
            const x = Math.fround(px), y = Math.fround(py);
            scene.camera = { x, y, height: 1 }; renderer.draw(scene);
            const cpu = evaluatePoint(id, x, y, scene.iterations, scene.parameters), gpu = renderer.readPoint(0, 0);
            const colored = cpu.status === 'converged' || cpu.status === 'escaped';
            // Below ~1e-7 the GPU residual may round to zero: the specified
            // safe fallback is an integer iteration, at most one step away.
            // The slow Julia boundary at the origin is checked separately.
            const boundary = id === 'phoenix' && preset === 2 && x === 0 && y === 0;
            const tolerance = cpu.status === 'converged' ? 1 : .15;
            if (gpu.status !== cpu.status || gpu.root !== cpu.root || (colored && !boundary && Math.abs(cpu.value - gpu.value) > tolerance)) failures.push(`${id} p${degree} preset${preset} (${x},${y}): CPU ${JSON.stringify(cpu)} GPU ${JSON.stringify(gpu)}`);
            samples++;
          }
          const computations = renderer.stats.computations;
          for (const palette of ['spectrum', 'aurora']) {
            scene.coloring = { palette, phase: .3, density: 2, interior: '#223344' }; renderer.draw(scene);
          }
          if (renderer.stats.computations !== computations) failures.push(`${id}: coloring repeated iterations`);
        }
      }
      for (const [id, x, y, status] of [['phoenix', 5, 0, 'escaped'], ['magnet-1', 2.01, 0, 'escaped'], ['nova', 0, 0, 'converged']] as const) {
        const scene = createScene(id); scene.camera = { x, y, height: 1 }; scene.iterations = 1;
        await renderer.prepare(id); renderer.draw(scene);
        if (renderer.readPoint(0, 0).status !== status) failures.push(`${id}: missed final update`);
      }
      const finalNewton = createScene('newton'); finalNewton.camera = { x: 1.01, y: 0, height: 1 };
      await renderer.prepare('newton');
      for (const [budget, expected] of [[1, 'unresolved'], [2, 'converged']] as const) {
        finalNewton.iterations = budget; renderer.draw(finalNewton);
        if (renderer.readPoint(0, 0).status !== expected) failures.push(`Newton: incorrect last update ${budget}`);
      }
      finalNewton.camera.x = 1e-8; finalNewton.parameters.power = 8; renderer.draw(finalNewton);
      if (renderer.readPoint(0, 0).status !== 'numerical-error') failures.push('Newton overflow was not identified');
    } finally { renderer.dispose(); }
    return { failures, samples };
  });
  expect(result.samples).toBeGreaterThan(150); expect(result.failures).toEqual([]);
});

test('parameter metadata drives numeric history, validation and color-only redraws', async ({ page }) => {
  test.setTimeout(180_000);
  // Keep UI interaction checks independent of full-frame binary64 throughput.
  // Full HD exports and hardware acceptance are exercised separately.
  await page.getByTestId('fractal-canvas').evaluate(canvas => { canvas.style.width='192px';canvas.style.height='108px'; });
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as {width:number;height:number}).width===Math.floor(192*Math.min(devicePixelRatio,1.5)));
  for (const [name, id, field, value] of [['Ньютон', 'newton', 'Степень Ньютона', '8'], ['Нова', 'nova', 'Релаксация', '1.5'], ['Феникс', 'phoenix', 'Память', '-0.6']] as const) {
    await page.getByRole('button', { name: `Открыть: ${name}`, exact: true }).click();
    const initial = await page.evaluate(() => window.__FRACTOL__!.scene());
    const input = page.getByRole('spinbutton', { name: field, exact: true });
    expect(await page.getByRole('spinbutton').evaluateAll(inputs => inputs.every(input => (input as HTMLInputElement).validity.valid))).toBe(true);
    await input.fill(value); await input.press('Enter');
    const changed = await page.evaluate(() => window.__FRACTOL__!.scene()); expect(changed.fractalId).toBe(id); expect(changed.parameters).not.toEqual(initial.parameters);
    await historyAction(page); expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(initial);
    await historyAction(page, 'Повторить действие'); expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(changed);
    await input.fill('99'); await expect(input).toHaveAttribute('aria-invalid', 'true'); await input.press('Enter');
    expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(changed);
    await expect(page.getByRole('button', { name: 'Изменять указателем', exact: true })).toHaveCount(0);
    await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready, undefined, { timeout: 120_000 });
    const before = await page.evaluate(() => window.__FRACTOL__!.stats() as { draws: number; computations: number });
    const palette = page.getByRole('button', { name: 'Палитра: Спектр', exact: true });
    if (await palette.getAttribute('aria-pressed') === 'true') await page.getByRole('button', { name: 'Палитра: Аврора', exact: true }).click();
    await palette.click();
    await page.getByRole('slider', { name: 'Сдвиг цвета', exact: true }).press('ArrowRight');
    await page.getByRole('slider', { name: 'Плотность цвета', exact: true }).press('ArrowRight');
    await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws)).toBeGreaterThan(before.draws);
    expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { computations: number }).computations)).toBe(before.computations);
    await page.waitForTimeout(200);
    const idle = await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window.__FRACTOL__!.stats() as { draws: number }).draws)).toBe(idle);
  }
});

test('float32-sensitive Phoenix boundary is evaluated separately from stable landmarks', async ({ page }) => {
  const measured = await page.evaluate(async () => {
    const rendererPath = '/src/rendering/renderer.ts', referencePath = '/src/domain/reference.ts', catalogPath = '/src/domain/catalog.ts';
    const { FractalRenderer } = await import(rendererPath), { evaluatePoint } = await import(referencePath), { createScene } = await import(catalogPath);
    const renderer = new FractalRenderer(document.createElement('canvas'));
    try {
      const scene = createScene('phoenix', 2); scene.camera = { x: 0, y: 0, height: 1 };
      await renderer.prepare('phoenix'); renderer.resize(1, 1); renderer.draw(scene);
      const gpu = renderer.readPoint(0, 0), neighborhood = [];
      // Different float32 operation order is amplified by a long boundary orbit.
      // Compare against a small neighborhood, not a falsely exact double oracle.
      for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) neighborhood.push(evaluatePoint('phoenix', 0, 0, 512, { ...scene.parameters, phoenixRe: Math.fround(scene.parameters.phoenixRe) + x * 6e-8, phoenixIm: Math.fround(scene.parameters.phoenixIm) + y * 1.5e-8 }));
      return { gpu, statuses: neighborhood.map(p => p.status), min: Math.min(...neighborhood.map(p => p.value)), max: Math.max(...neighborhood.map(p => p.value)) };
    } finally { renderer.dispose(); }
  });
  expect(measured.statuses).toContain(measured.gpu.status);
  expect(measured.gpu.value).toBeGreaterThanOrEqual(measured.min - 1); expect(measured.gpu.value).toBeLessThanOrEqual(measured.max + 1);
});

test('all new presets round-trip links and library v1 with idempotent import', async ({ page }) => {
  const snapshots = await page.evaluate(async () => {
    const path = '/src/domain/catalog.ts', { createScene } = await import(path);
    return ['newton', 'nova', 'phoenix', 'magnet-1'].flatMap(id => [0, 1, 2].map(preset => createScene(id, preset)));
  });
  for (const snapshot of snapshots) {
    const hash = '#scene=' + encodeURIComponent(JSON.stringify(snapshot));
    await page.goto('/?debug=1' + hash);
    await page.waitForFunction(id => (window.__FRACTOL__?.stats() as { fractalId: string })?.fractalId === id, snapshot.fractalId);
    expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(snapshot);
    if (snapshot.fractalId === 'nova' && snapshot.parameters.novaRelaxation === 1) {
      // Hash-only navigation intentionally retains the exploration history.
      // Start a fresh tab session before asserting an empty history.
      await page.reload(); await page.waitForFunction(() => (window.__FRACTOL__?.stats() as { draws: number })?.draws > 0);
      await page.getByRole('button', { name: 'Рождение Новы', exact: true }).click();
      await page.getByRole('button', { name: 'Ещё', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Отменить действие', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
    }
  }
  const file = { name: 'new-formulas.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, favorites: ['newton', 'nova', 'phoenix', 'magnet-1'], scenes: snapshots.map((scene, i) => ({ id: `v13-${i}`, name: `Сцена ${i}`, createdAt: '2026-10-18T12:00:00Z', scene })) })) };
  await page.getByRole('button', { name: /^Моя коллекция/ }).click();
  await page.getByLabel('Файл коллекции').setInputFiles(file); await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.locator('.saved-list article')).toHaveCount(12);
  await page.getByLabel('Файл коллекции').setInputFiles(file); await expect(page.getByText(/Новых сцен: 0 · Повторов: 12/)).toBeVisible(); await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Экспорт JSON', exact: true }).click();
  const download = await pending, exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.scenes).toHaveLength(12); expect(exported.favorites).toHaveLength(4);
});

test('new kernels restore context and export full-resolution PNG in every quality profile', async ({ page }) => {
  test.setTimeout(600_000);
  for (const [id, profile] of [['newton', 'Авто'], ['nova', 'Плавность'], ['phoenix', 'Качество'], ['magnet-1', 'Авто']] as const) {
    await page.evaluate(id => window.__FRACTOL__!.select(id), id);
    await page.waitForFunction(id => (window.__FRACTOL__!.stats() as { fractalId: string }).fractalId === id, id);
    await page.getByRole('button', { name: 'Оформление', exact: true }).click(); await page.getByRole('group', { name: 'Профиль качества', exact: true }).getByRole('radio', { name: new RegExp(`^${profile}`) }).check(); await page.getByRole('button', { name: 'Закрыть диалог', exact: true }).click();
    const snapshot = await page.evaluate(() => window.__FRACTOL__!.scene());
    const extension = await page.evaluateHandle(() => {
      const r = window.__FRACTOL__!.renderer() as { getContext(): WebGL2RenderingContext }, extension = r.getContext().getExtension('WEBGL_lose_context');
      return extension;
    });
    if (await extension.evaluate(ext => !!ext)) {
      await extension.evaluate(ext => ext!.loseContext());
      await expect(page.getByText('Восстанавливаем изображение', { exact: true })).toBeVisible();
      await extension.evaluate(ext => ext!.restoreContext());
      await expect(page.getByText('Восстанавливаем изображение', { exact: true })).toBeHidden();
    }
    await extension.dispose();
    await page.getByRole('button', { name: 'Экспорт PNG', exact: true }).click();
    await page.getByRole('button', { name: /Full HD/ }).click();
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click(); const download = await pending;
    expect(download.suggestedFilename()).toBe(`fractol-${id}.png`);
    const bytes = await readFile((await download.path())!); expect(bytes.readUInt32BE(16)).toBe(1920); expect(bytes.readUInt32BE(20)).toBe(1080);
    expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(snapshot);
  }
});

test('new formulas share mobile gestures and grouped undo', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload(); await page.waitForFunction(() => (window.__FRACTOL__?.stats() as { draws: number })?.draws > 0);
  for (const [panel, close] of [['catalog-panel', 'Закрыть каталог'], ['controls-panel', 'Скрыть параметры']] as const) if (await page.getByTestId(panel).isVisible()) await page.getByRole('button', { name: close, exact: true }).click();
  await page.waitForTimeout(250);
  for (const id of ['newton', 'nova', 'phoenix', 'magnet-1'] as const) {
    await page.evaluate(id => window.__FRACTOL__!.select(id), id);
    const initial = await page.evaluate(() => window.__FRACTOL__!.scene());
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 350, id: 1 }, { x: 220, y: 350, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 350, id: 1 }, { x: 250, y: 350, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    } else { await page.mouse.move(190, 350); await page.mouse.wheel(0, -200); await page.waitForTimeout(350); }
    expect((await page.evaluate(() => window.__FRACTOL__!.scene())).camera.height).toBeLessThan(initial.camera.height);
    await historyAction(page); expect(await page.evaluate(() => window.__FRACTOL__!.scene())).toEqual(initial);
  }
});
