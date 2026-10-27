import { expect, test, type Page } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => ((window.__FRACTOL__?.stats() as { draws?: number })?.draws ?? 0) > 0);
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

for (const width of [320, 390, 900]) test(`save and share have usable accessible actions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await page.reload();
  await page.waitForFunction(() => ((window.__FRACTOL__?.stats() as { draws?: number })?.draws ?? 0) > 0);
  for (const name of ['Сохранить', 'Поделиться сценой', 'Экспорт PNG']) {
    const action = page.getByRole('button', { name, exact: true }); await expect(action).toBeVisible();
    const box = (await action.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название сцены' }).fill(`Сцена ${width}`);
  await page.getByRole('button', { name: 'Сохранить сцену', exact: true }).click();
  const expected = await page.evaluate(() => window.__FRACTOL__!.scene());
  await page.getByRole('button', { name: 'Поделиться сценой', exact: true }).click();
  await expect(page).toHaveURL(/#scene=/);
  expect(await page.evaluate(() => JSON.parse(decodeURIComponent(location.hash.slice(7))))).toEqual(expected);
});

test('Julia drafts validate and restore the accepted value before saving', async ({ page }) => {
  await page.getByRole('button', { name: 'Открыть: Жюлиа', exact: true }).click();
  const input = page.getByLabel('Действительная часть Julia');
  expect(await input.evaluate(input => (input as HTMLInputElement).validity.valid)).toBe(true);
  const initial = await page.evaluate(() => window.__FRACTOL__!.scene().parameters.juliaRe);
  await input.fill('3'); await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => window.__FRACTOL__!.scene().parameters.juliaRe)).toBe(initial);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(input).toHaveValue(String(initial));
  await page.getByRole('textbox', { name: 'Название сцены' }).fill('Проверенная константа');
  await page.getByRole('button', { name: 'Сохранить сцену', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fractol.library.v1')!).scenes[0].scene.parameters.juliaRe)).toBe(initial);
  await input.fill(''); await expect(input).toHaveAttribute('aria-invalid', 'true');
  // Finishing the dialog transition must not steal focus from a newly chosen field.
  await page.waitForTimeout(300); await expect(input).toBeFocused();
  await input.pressSequentially('-0.8'); await expect(input).toHaveValue('-0.8');
  expect(await page.evaluate(() => window.__FRACTOL__!.scene().parameters.juliaRe)).toBe(-.8);
  await input.fill(''); await input.press('Tab'); await expect(input).toHaveValue('-0.8');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
});

test('concurrent cold preparations share the color program and release every program', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/src/rendering/renderer.ts', { FractalRenderer } = await import(path);
    const renderer = new FractalRenderer(document.createElement('canvas')), gl: WebGL2RenderingContext = renderer.getContext();
    const programs: WebGLProgram[] = [], create = gl.createProgram.bind(gl);
    gl.createProgram = () => { const program = create(); if (program) programs.push(program); return program; };
    try { await Promise.all([renderer.prepare('mandelbrot'), renderer.prepare('julia'), renderer.prepare('mandelbrot')]); }
    finally { renderer.dispose(); }
    return { count: programs.length, live: programs.filter(program => gl.isProgram(program)).length };
  });
  // Two formula programs, one shared color program and one shared raw-field
  // projection program. Concurrent preparation must not duplicate either.
  expect(result).toEqual({ count: 4, live: 0 });
});

test('disposing a cold preparation cancels it without retaining a program', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/src/rendering/renderer.ts', { FractalRenderer } = await import(path);
    const renderer = new FractalRenderer(document.createElement('canvas')), gl: WebGL2RenderingContext = renderer.getContext();
    const programs: WebGLProgram[] = [], create = gl.createProgram.bind(gl);
    gl.createProgram = () => { const program = create(); if (program) programs.push(program); return program; };
    const pending = renderer.prepare('mandelbrot'); renderer.dispose();
    const [outcome] = await Promise.allSettled([pending]);
    return { status: outcome.status, live: programs.filter(program => gl.isProgram(program)).length };
  });
  expect(result).toEqual({ status: 'rejected', live: 0 });
});

test('GPU includes bounded radius-two boundary points and keeps the legacy bailout', async ({ page }) => {
  const failures = await page.evaluate(async () => {
    const rendererPath = '/src/rendering/renderer.ts', catalogPath = '/src/domain/catalog.ts';
    const { FractalRenderer } = await import(rendererPath), { createScene } = await import(catalogPath);
    const renderer = new FractalRenderer(document.createElement('canvas')), failures: string[] = [];
    try {
      for (const id of ['mandelbrot', 'burning-ship', 'tricorn', 'multibrot', 'celtic', 'buffalo', 'perpendicular', 'legacy-ship']) {
        const scene = createScene(id); scene.camera = { x: -2, y: 0, height: 1 }; scene.parameters.power = 2;
        await renderer.prepare(id); renderer.resize(1, 1); renderer.draw(scene);
        if (renderer.readPoint(0, 0).escaped !== (id === 'legacy-ship')) failures.push(id);
      }
    } finally { renderer.dispose(); }
    return failures;
  });
  expect(failures).toEqual([]);
});

test('context restoration during delayed compilation does not show an obsolete error', async ({ page }) => {
  const supported = await page.evaluate(async () => {
    const renderer = window.__FRACTOL__!.renderer() as { getContext(): WebGL2RenderingContext; delay: () => Promise<void> };
    const gl = renderer.getContext(), parallel = gl.getExtension('KHR_parallel_shader_compile'), loss = gl.getExtension('WEBGL_lose_context');
    if (!parallel || !loss) return false;
    const originalDelay = renderer.delay, originalParameter = gl.getProgramParameter.bind(gl);
    let entered!: () => void, holdOnce = true;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    renderer.delay = () => { entered(); return new Promise(resolve => setTimeout(resolve, 500)); };
    gl.getProgramParameter = (program, parameter) => {
      if (holdOnce && parameter === parallel.COMPLETION_STATUS_KHR) { holdOnce = false; return false; }
      return originalParameter(program, parameter);
    };
    try {
      window.__FRACTOL__!.select('julia'); await waiting;
      loss.loseContext(); await new Promise(resolve => setTimeout(resolve, 150)); loss.restoreContext();
    } finally { renderer.delay = originalDelay; gl.getProgramParameter = originalParameter; }
    return true;
  });
  test.skip(!supported, 'Parallel compile/context-loss extensions unavailable');
  await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { fractalId: string }).fractalId)).toBe('julia');
  await expect(page.getByText('Изображение недоступно', { exact: true })).toBeHidden();
  await expect(page.getByText('Восстанавливаем изображение', { exact: true })).toBeHidden();
});

