import { expect, test } from '@playwright/test';
import { emulateTouchCapabilities } from './helpers';

test('Julia float preview publishes atomically without partial tile events', async ({ page }) => {
  await page.goto('/?debug=1');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/rendering/renderer.ts', catalogPath = '/src/domain/catalog.ts', jobsPath = '/src/rendering/jobs.ts';
    const { WebGLBackend } = await import(rendererPath);
    const { createScene } = await import(catalogPath);
    const { RenderJobs } = await import(jobsPath);
    const backend = new WebGLBackend(document.createElement('canvas'));
    const control = new WebGLBackend(document.createElement('canvas'));
    const scene = createScene('julia'); scene.iterations = 64; scene.parameters.juliaRe = -.2; scene.parameters.juliaIm = .7;
    const events: { type: string; fieldId: number }[] = [];
    const off = backend.subscribeRenderEvents((event: { type: string; fieldId: number }) => events.push({ type: event.type, fieldId: event.fieldId }));
    try {
      backend.resize(17, 13); await backend.prepare('julia');
      control.resize(17, 13); await control.prepare('julia');
      await control.preview({ scene, job: new RenderJobs().begin('preview'), arithmetic: 'float32', interactive: true, publication: 'atomic' });
      const referencePoints = [[0, 0], [8, 6], [16, 12], [16, 0], [0, 12]].map(([x, y]) => control.readPoint(x, y));
      const gl = backend.getContext(); gl.viewport(0, 0, 1, 1); gl.bindVertexArray(null);
      await backend.preview({ scene, job: new RenderJobs().begin('preview'), arithmetic: 'float32', interactive: true, publication: 'atomic' });
      const actualPoints = [[0, 0], [8, 6], [16, 12], [16, 0], [0, 12]].map(([x, y]) => backend.readPoint(x, y));
      return { events, stats: backend.getSnapshot(), counters: backend.getRenderCounters(), referencePoints, actualPoints };
    } finally { off(); backend.dispose(); control.dispose(); }
  });
  expect(result.events.some(event => event.type === 'field-submitted')).toBe(true);
  expect(result.events.filter(event => event.type === 'field-ready')).toHaveLength(1);
  expect(result.events.filter(event => event.type === 'presentation')).toHaveLength(1);
  expect(result.events.some(event => event.type === 'tile-published')).toBe(false);
  expect(result.counters.submittedFields).toBe(1);
  expect(result.counters.readyFields).toBe(1);
  expect(result.actualPoints).toEqual(result.referencePoints);
});

test('atomic float previews keep GPU timer samples flowing beyond the 32-query warmup pool', async ({ page }, testInfo) => {
  await page.goto('/?debug=1');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/rendering/renderer.ts', catalogPath = '/src/domain/catalog.ts', jobsPath = '/src/rendering/jobs.ts';
    const { WebGLBackend } = await import(rendererPath);
    const { createScene } = await import(catalogPath);
    const { RenderJobs } = await import(jobsPath);
    const backend = new WebGLBackend(document.createElement('canvas'));
    const scene = createScene('julia'); scene.iterations = 64;
    backend.resize(64, 48); await backend.prepare('julia');
    const capabilities = backend.getCapabilities();
    const samples: { id: number; jobId?: number; submittedAt: number; observedAt: number; kind?: string }[] = [];
    const off = backend.subscribeMeasurements((sample: { id: number; jobId?: number; submittedAt: number; kind?: string }) => {
      samples.push({ ...sample, observedAt: performance.now() });
    });
    const jobs = new RenderJobs(), measuredJobIds: number[] = [];
    const preview = async (index: number, capture: boolean) => {
      scene.parameters.juliaRe = -.2 + index * .00001;
      scene.parameters.juliaIm = .7 - index * .00001;
      const job = jobs.begin('preview');
      if (capture) measuredJobIds.push(job.id);
      await backend.preview({ scene, job, arithmetic: 'float32', interactive: true, publication: 'atomic' });
    };
    try {
      if (!capabilities.gpuTimer) return {
        capabilities, readyDuringWindow: 0, durationMs: 0, measuredJobIds: [], during: [], samples: [],
        collectionStartedAt: 0, collectionEndedAt: 0,
      };
      // Fill the timer-query pool before measuring, matching the old failure mode.
      for (let i = 0; i < 32; i++) await preview(i, false);
      const collectionStartedAt = performance.now();
      const readyBefore = backend.getRenderCounters().readyFields;
      for (let i = 0; i < 64; i++) await preview(32 + i, true);
      const collectionEndedAt = performance.now();
      const readyAfter = backend.getRenderCounters().readyFields;
      const during = samples.filter(sample => measuredJobIds.includes(sample.jobId ?? -1) && sample.observedAt <= collectionEndedAt);
      // The supported public drain observes any final timer results after all 64 fields have completed.
      await backend.drainGpuMeasurements(500);
      return {
        capabilities, readyDuringWindow: readyAfter - readyBefore, durationMs: collectionEndedAt - collectionStartedAt,
        measuredJobIds, during, samples: samples.filter(sample => measuredJobIds.includes(sample.jobId ?? -1)),
        collectionStartedAt, collectionEndedAt,
      };
    } finally { off(); backend.dispose(); }
  });

  await testInfo.attach('atomic-gpu-poll-window.json', { body: Buffer.from(JSON.stringify({
    gpuTimerAvailable: result.capabilities.gpuTimer,
    readyDuringWindow: result.readyDuringWindow,
    collectionDurationMs: result.durationMs,
    measuredJobs: result.measuredJobIds.length,
    samplesDeliveredDuringWindow: result.during.length,
    samplesAfterDrain: result.samples.length,
    uniqueSampleIds: new Set(result.samples.map(sample => sample.id)).size,
    uniqueJobIds: new Set(result.samples.map(sample => sample.jobId)).size,
    collectionStartedAt: result.collectionStartedAt,
    collectionEndedAt: result.collectionEndedAt,
    samples: result.samples,
  }, null, 2)), contentType: 'application/json' });
  test.skip(!result.capabilities.gpuTimer, 'GPU timer query extension is unavailable on this browser/device.');
  expect(result.readyDuringWindow).toBe(64);
  expect(result.during.length).toBeGreaterThan(0);
  expect(result.samples.length).toBeGreaterThanOrEqual(64);
  expect(new Set(result.samples.map(sample => sample.id)).size).toBe(result.samples.length);
  expect(new Set(result.samples.map(sample => sample.jobId)).size).toBeGreaterThanOrEqual(64);
  expect(result.samples.every(sample => sample.kind === 'preview')).toBe(true);
  expect(result.samples.every(sample => sample.submittedAt >= result.collectionStartedAt && sample.submittedAt < result.collectionEndedAt)).toBe(true);
  expect(result.during.every(sample => sample.observedAt >= result.collectionStartedAt)).toBe(true);
});

test('a held atomic float fence keeps the last presented image until the new field is ready', async ({ page }) => {
  await page.goto('/?debug=1');
  await page.evaluate(async () => {
    document.body.replaceChildren(); document.body.style.cssText = 'margin:0;background:#000';
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'display:block;width:384px;height:288px'; document.body.append(canvas);
    const rendererPath = '/src/rendering/renderer.ts', catalogPath = '/src/domain/catalog.ts', jobsPath = '/src/rendering/jobs.ts';
    const { WebGLBackend } = await import(rendererPath), { createScene } = await import(catalogPath), { RenderJobs } = await import(jobsPath);
    const backend = new WebGLBackend(canvas), scene = createScene('julia'); scene.iterations = 128;
    backend.resize(192, 144); await backend.prepare('julia');
    await backend.preview({ scene, job: new RenderJobs().begin('preview'), arithmetic: 'float32', publication: 'atomic' });
    const gl = backend.getContext(), originalWait = gl.clientWaitSync.bind(gl);
    const probe = { backend, scene, jobs: new RenderJobs(), hold: false, polls: 0, pending: Promise.resolve(), originalWait };
    gl.clientWaitSync = ((...args: Parameters<WebGL2RenderingContext['clientWaitSync']>) => {
      if (probe.hold) { probe.polls++; return gl.TIMEOUT_EXPIRED; }
      return probe.originalWait(...args);
    }) as WebGL2RenderingContext['clientWaitSync'];
    (window as unknown as { __heldAtomicProbe: typeof probe }).__heldAtomicProbe = probe;
  });
  await page.waitForTimeout(100);
  const before = await page.screenshot();
  try {
    await page.evaluate(() => {
      const probe = (window as unknown as { __heldAtomicProbe: { backend: { preview(request: unknown): Promise<void> }; scene: import('../../src/domain/types').SceneState; jobs: { begin(name: string): unknown }; hold: boolean; pending: Promise<void> } }).__heldAtomicProbe;
      probe.hold = true;
      const changed = { ...probe.scene, camera: { ...probe.scene.camera, x: probe.scene.camera.x + .8 } };
      probe.pending = probe.backend.preview({ scene: changed, job: probe.jobs.begin('preview'), arithmetic: 'float32', publication: 'atomic' });
    });
    await page.waitForFunction(() => (window as unknown as { __heldAtomicProbe: { polls: number } }).__heldAtomicProbe.polls > 0);
    await page.waitForTimeout(100);
    const whileHeld = await page.screenshot();
    expect(whileHeld.equals(before)).toBe(true);
    await page.evaluate(async () => {
      const probe = (window as unknown as { __heldAtomicProbe: { hold: boolean; pending: Promise<void> } }).__heldAtomicProbe;
      probe.hold = false; await probe.pending;
    });
    await page.waitForTimeout(50);
    const after = await page.screenshot();
    expect(after.equals(before)).toBe(false);
  } finally {
    await page.evaluate(() => {
      const probe = (window as unknown as { __heldAtomicProbe?: { backend: { dispose(): void }; hold: boolean; pending: Promise<void> } }).__heldAtomicProbe;
      if (probe) { probe.hold = false; void probe.pending.catch(() => {}); probe.backend.dispose(); delete (window as unknown as { __heldAtomicProbe?: unknown }).__heldAtomicProbe; }
    });
  }
});

test('held Julia preview remains unavailable to fast PNG until the ready field is atomically presented', async ({ page }, testInfo) => {
  await page.goto('/?debug=1');
  await page.evaluate(() => window.__FRACTOL__!.select('julia'));
  await page.waitForFunction(() => window.__FRACTOL__!.scene().fractalId === 'julia' && (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready);
  const canvas = page.getByTestId('fractal-canvas');
  const heldImageClip = { x: 500, y: 300, width: 440, height: 180 };
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;cursor:none!important}[data-testid="diagnostics"]{visibility:hidden!important}' });
  await page.getByRole('button', { name: 'Экспорт PNG' }).click();
  await page.locator('input[name="export-kind"][value="viewing"]').check();
  await expect(page.getByRole('button', { name: 'Скачать PNG' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByRole('button', { name: 'Изменять указателем' }).click();
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready);
  await page.waitForTimeout(50);
  const before = await page.screenshot({ clip: heldImageClip, path: testInfo.outputPath('before.png') });
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('full-before.png') });

  await page.evaluate(() => {
    const diagnostics = window.__FRACTOL__!.renderer() as { getContext(): WebGL2RenderingContext };
    const gl = diagnostics.getContext(), original = gl.clientWaitSync.bind(gl), originalFence = gl.fenceSync.bind(gl);
    const heldFences = new Set<WebGLSync>();
    const gate = { gl, original, originalFence, heldFences, hold: false, polls: 0 };
    gl.fenceSync = ((...args: Parameters<WebGL2RenderingContext['fenceSync']>) => {
      const sync = gate.originalFence(...args); if (sync) gate.heldFences.add(sync); return sync;
    }) as WebGL2RenderingContext['fenceSync'];
    gl.clientWaitSync = ((...args: Parameters<WebGL2RenderingContext['clientWaitSync']>) => {
      if (gate.hold && gate.heldFences.has(args[0]) && args[2] === 0) { gate.polls++; return gl.TIMEOUT_EXPIRED; }
      return gate.original(...args);
    }) as WebGL2RenderingContext['clientWaitSync'];
    (window as unknown as { __previewGate: typeof gate }).__previewGate = gate;
  });
  try {
    const box = (await canvas.boundingBox())!;
    await page.evaluate(() => (window as unknown as { __previewGate: { hold: boolean } }).__previewGate.hold = true);
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
    await page.mouse.move(box.x + box.width * .62, box.y + box.height * .42, { steps: 3 });
    await page.waitForFunction(() => (window as unknown as { __previewGate: { polls: number } }).__previewGate.polls > 0);
    await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready)).toBe(false);
    await page.getByRole('button', { name: 'Экспорт PNG' }).click();
    await page.locator('input[name="export-kind"][value="viewing"]').check();
    await expect(page.getByRole('button', { name: 'Скачать PNG' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.waitForTimeout(50);
    expect((await page.screenshot({ clip: heldImageClip, path: testInfo.outputPath('during.png') })).equals(before)).toBe(true);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('full-during.png') });

    await page.evaluate(() => (window as unknown as { __previewGate: { hold: boolean } }).__previewGate.hold = false);
    await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready), { timeout: 10_000 }).toBe(true);
    await page.getByRole('button', { name: 'Экспорт PNG' }).click();
    await page.locator('input[name="export-kind"][value="viewing"]').check();
    await expect(page.getByRole('button', { name: 'Скачать PNG' })).toBeEnabled();
    await page.keyboard.press('Escape');
    expect((await page.screenshot({ clip: heldImageClip, path: testInfo.outputPath('after.png') })).equals(before)).toBe(false);
  } finally {
    await page.evaluate(() => {
      const gate = (window as unknown as { __previewGate?: { gl: WebGL2RenderingContext; original: WebGL2RenderingContext['clientWaitSync']; originalFence: WebGL2RenderingContext['fenceSync']; hold: boolean } }).__previewGate;
      if (gate) { gate.hold = false; gate.gl.clientWaitSync = gate.original; gate.gl.fenceSync = gate.originalFence; delete (window as unknown as { __previewGate?: unknown }).__previewGate; }
    });
  }
});

test('a settled Julia field is restored from cache and counted as a cache presentation', async ({ page }) => {
  await page.goto('/?debug=1');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/rendering/renderer.ts', catalogPath = '/src/domain/catalog.ts', jobsPath = '/src/rendering/jobs.ts';
    const identityPath = '/src/domain/previewCache.ts';
    const { WebGLBackend } = await import(rendererPath);
    const { createScene } = await import(catalogPath);
    const { RenderJobs } = await import(jobsPath);
    const { previewFieldKey } = await import(identityPath);
    const backend = new WebGLBackend(document.createElement('canvas'));
    const scene = createScene('julia'); scene.iterations = 64;
    const width = 19, height = 13;
    const field = { scene, arithmetic: 'float32' as const, arithmeticVersion: backend.previewArithmeticVersion('float32'), width, height };
    try {
      backend.configurePreviewCache('standard', true); backend.resize(width, height); await backend.prepare('julia');
      await backend.preview({ scene, job: new RenderJobs().begin('preview'), arithmetic: 'float32', publication: 'atomic' });
      const pointBefore = backend.readPoint(9, 6), computationsBefore = backend.getSnapshot().computations;
      const drawsBeforeRetain = backend.getSnapshot().draws;
      backend.retainPreviewField(field);
      const drawsAfterRetain = backend.getSnapshot().draws;
      const deadline = performance.now() + 5000;
      let retained = false;
      while (!retained && performance.now() < deadline) {
        retained = backend.getMemoryEstimate().previewCacheEntries === 1 && backend.restorePreviewField(field, new RenderJobs().begin('preview'));
        if (!retained) await new Promise(resolve => setTimeout(resolve, 8));
      }
      if (!retained) throw Error('Settled Julia field was not retained.');
      const restoredPoint = backend.readPoint(9, 6);
      const changed = { ...scene, camera: { ...scene.camera, x: scene.camera.x + .4 } };
      const changedField = { ...field, scene: changed };
      await backend.preview({ scene: changed, job: new RenderJobs().begin('preview'), arithmetic: 'float32', publication: 'atomic' });
      const computationsAfterChange = backend.getSnapshot().computations, changedPoint = backend.readPoint(9, 6);
      const restoredAfterMathChange = backend.restorePreviewField(field, new RenderJobs().begin('preview'));
      const finalPoint = backend.readPoint(9, 6);
      return { restored: retained && restoredAfterMathChange, pointBefore, restoredPoint, changedPoint, finalPoint,
        keysDiffer: previewFieldKey(field) !== previewFieldKey(changedField),
        drawsBeforeRetain, drawsAfterRetain,
        computationsBefore, computationsAfterChange, computationsAfterRestore: backend.getSnapshot().computations,
        stats: backend.getSnapshot(), memory: backend.getMemoryEstimate(), counters: backend.getRenderCounters() };
    } finally { backend.dispose(); }
  });
  expect(result.restored).toBe(true);
  expect(result.keysDiffer).toBe(true);
  expect(result.restoredPoint).toEqual(result.pointBefore);
  expect(result.finalPoint).toEqual(result.pointBefore);
  expect(result.computationsAfterChange).toBe(result.computationsBefore + 1);
  expect(result.computationsAfterRestore).toBe(result.computationsAfterChange);
  expect(result.drawsAfterRetain).toBe(result.drawsBeforeRetain);
  expect(result.memory.previewCacheEntries).toBe(1);
  expect(result.stats.presentationKind).toBe('cache');
  expect(result.counters.restoredFields).toBe(2);
  expect(result.counters.presentations.cache).toBe(2);
});

test('Julia double-single 3584 iteration preview swaps atomically on a small field', async ({ page }) => {
  await page.goto('/?debug=1');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/rendering/renderer.ts', catalogPath = '/src/domain/catalog.ts', jobsPath = '/src/rendering/jobs.ts';
    const { WebGLBackend } = await import(rendererPath), { createScene } = await import(catalogPath), { RenderJobs } = await import(jobsPath);
    const backend = new WebGLBackend(document.createElement('canvas'));
    const scene = createScene('julia'); scene.iterations = 3584; scene.parameters.juliaRe = 0; scene.parameters.juliaIm = 0;
    const events: string[] = [];
    const off = backend.subscribeRenderEvents((event: { type: string }) => events.push(event.type));
    try {
      backend.resize(17, 13); await backend.prepare('julia');
      await backend.preview({ scene, job: new RenderJobs().begin('preview'), arithmetic: 'double-single', interactive: true, publication: 'atomic' });
      return { events, stats: backend.getSnapshot(), point: backend.readPoint(8, 6) };
    } finally { off(); backend.dispose(); }
  });
  expect(result.events).toContain('field-submitted');
  expect(result.events).toContain('field-ready');
  expect(result.events).not.toContain('tile-published');
  expect(result.stats.computations).toBe(1);
  expect(result.stats.arithmetic).toContain('double-single');
  expect(result.point).toBeTruthy();
});

test('diagnostic A/B modes keep event counters and subscriptions while toggling field cache', async ({ page }) => {
  await page.goto('/?debug=1');
  await page.evaluate(() => window.__FRACTOL__!.select('julia'));
  await page.waitForFunction(() => window.__FRACTOL__!.scene().fractalId === 'julia' && (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready);
  await page.evaluate(() => {
    type Event = { type: string };
    const diagnostics = window.__FRACTOL__!.renderer() as {
      setNavigationFeatures(continuousJulia: boolean, cache: boolean): void;
      getRenderCounters(): { submittedFields: number; readyFields: number };
      getMemoryEstimate(): { previewCacheEntries?: number };
      subscribeRenderEvents(listener: (event: Event) => void): () => void;
    };
    const state = { diagnostics, events: [] as Event[] };
    (window as unknown as { __juliaCacheProbe: typeof state }).__juliaCacheProbe = state;
    diagnostics.subscribeRenderEvents(event => state.events.push(event));
    diagnostics.setNavigationFeatures(false, false);
  });
  await page.waitForFunction(() => (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready);
  const disabledReady = await page.evaluate(() => (window.__FRACTOL__!.renderer() as { getRenderCounters(): { readyFields: number } }).getRenderCounters().readyFields);
  await page.getByRole('button', { name: 'Изменять указателем' }).click();
  const canvas = page.getByTestId('fractal-canvas'), box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .48, box.y + box.height * .49);
  await page.mouse.move(box.x + box.width * .53, box.y + box.height * .52, { steps: 4 });
  await page.waitForFunction((count) => (window.__FRACTOL__!.renderer() as { getRenderCounters(): { readyFields: number } }).getRenderCounters().readyFields > count, disabledReady);
  await page.getByRole('button', { name: 'Завершить' }).click();
  const disabled = await page.evaluate(() => {
    const probe = (window as unknown as { __juliaCacheProbe: { diagnostics: { getRenderCounters(): { submittedFields: number; readyFields: number }; getMemoryEstimate(): { previewCacheEntries?: number } }; events: { type: string }[] } }).__juliaCacheProbe;
    return { counters: probe.diagnostics.getRenderCounters(), cacheEntries: probe.diagnostics.getMemoryEstimate().previewCacheEntries ?? 0, events: probe.events.length };
  });
  expect(disabled.cacheEntries).toBe(0);

  const enabledBase = disabled.counters.readyFields;
  await page.evaluate(() => {
    const probe = (window as unknown as { __juliaCacheProbe: { diagnostics: { setNavigationFeatures(continuousJulia: boolean, cache: boolean): void } } }).__juliaCacheProbe;
    probe.diagnostics.setNavigationFeatures(true, true);
  });
  await page.getByRole('button', { name: 'Изменять указателем' }).click();
  await page.mouse.move(box.x + box.width * .50, box.y + box.height * .50);
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .54, { steps: 4 });
  await page.waitForFunction((count) => (window.__FRACTOL__!.renderer() as { getRenderCounters(): { readyFields: number } }).getRenderCounters().readyFields > count, enabledBase);
  await page.getByRole('button', { name: 'Завершить' }).click();
  await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.renderer() as { getMemoryEstimate(): { previewCacheEntries?: number } }).getMemoryEstimate().previewCacheEntries ?? 0)).toBeGreaterThan(0);
  const enabled = await page.evaluate(() => {
    const probe = (window as unknown as { __juliaCacheProbe: { diagnostics: { getRenderCounters(): { submittedFields: number; readyFields: number }; getMemoryEstimate(): { previewCacheEntries?: number } }; events: { type: string }[] } }).__juliaCacheProbe;
    return { counters: probe.diagnostics.getRenderCounters(), cacheEntries: probe.diagnostics.getMemoryEstimate().previewCacheEntries ?? 0, events: probe.events };
  });
  expect(enabled.cacheEntries).toBeGreaterThan(0);
  expect(enabled.counters.submittedFields).toBeGreaterThan(disabled.counters.submittedFields);
  expect(enabled.counters.readyFields).toBeGreaterThan(disabled.counters.readyFields);
  expect(enabled.events.some(event => event.type === 'field-ready')).toBe(true);
});

test('continuous Julia pointer activity stays within the economy 30-field cadence', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await context.newPage();
  try {
    await emulateTouchCapabilities(page, true);
    await page.goto('/?debug=1');
    await expect.poll(() => page.evaluate(() => (window.__FRACTOL__!.stats() as { resourceMode: string }).resourceMode)).toBe('economy');
    await page.evaluate(() => window.__FRACTOL__!.select('julia'));
    await page.waitForFunction(() => window.__FRACTOL__!.scene().fractalId === 'julia' && (window.__FRACTOL__!.stats() as { viewing: { ready: boolean } }).viewing.ready);
    const controls = page.getByTestId('controls-panel');
    if (!await controls.isVisible()) await page.getByRole('button', { name: 'Параметры', exact: true }).click();
    await expect(controls).toBeVisible();
    await page.getByRole('button', { name: 'Изменять указателем' }).click();
    const counts = await page.evaluate(async () => {
      type Event = { type: string; timestamp: number };
      const diagnostics = window.__FRACTOL__!.renderer() as { subscribeRenderEvents(listener: (event: Event) => void): () => void };
      const events: Event[] = [], off = diagnostics.subscribeRenderEvents(event => events.push(event));
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="fractal-canvas"]')!;
      const startedAt = performance.now();
      await new Promise<void>(resolve => {
        const move = (now: number) => {
          const progress = Math.min(1, (now - startedAt) / 2000);
          canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse',
            clientX: 150 + progress * 70, clientY: 360 + Math.sin(progress * 20) * 30 }));
          if (progress < 1) requestAnimationFrame(move); else resolve();
        };
        requestAnimationFrame(move);
      });
      const endedAt = performance.now(); off();
      return { durationMs: endedAt - startedAt, submitted: events.filter(event => event.type === 'field-submitted').length,
        ready: events.filter(event => event.type === 'field-ready').length, presentations: events.filter(event => event.type === 'presentation').length };
    });
    const allowance = Math.ceil(counts.durationMs / 1000 * 30) + 1;
    expect(counts.durationMs).toBeGreaterThanOrEqual(1900);
    expect(counts.submitted).toBeGreaterThan(0);
    expect(counts.submitted).toBeLessThanOrEqual(allowance);
    expect(counts.presentations).toBeLessThanOrEqual(allowance);
    expect(counts.ready).toBeLessThanOrEqual(counts.submitted);
  } finally { await context.close(); }
});

test('GPU fence polling remains nonblocking and event windows count only in-window host observations', async ({ page }) => {
  await page.goto('/?debug=1');
  const result = await page.evaluate(async () => {
    const fencePath = '/src/rendering/gpuFence.ts', eventsPath = '/src/domain/renderEvents.ts';
    const samplesPath = '/src/domain/renderEventSamples.ts', benchmarkPath = '/src/domain/benchmark.ts';
    const { settleFence } = await import(fencePath);
    const { emptyRenderCounters } = await import(eventsPath);
    const renderEventsPath = '/src/rendering/renderEvents.ts';
    const { RenderEvents } = await import(renderEventsPath);
    const { RenderEventSamples } = await import(samplesPath);
    const calls: unknown[][] = [], statuses = [1, 2]; let deleted = 0;
    const gl = {
      TIMEOUT_EXPIRED: 1, WAIT_FAILED: 3, SYNC_FLUSH_COMMANDS_BIT: 4,
      clientWaitSync: (...args: unknown[]) => { calls.push(args); return statuses.shift() ?? 2; },
      isContextLost: () => false, deleteSync: () => { deleted++; },
    };
    const fence = { sync: {}, started: performance.now(), polls: 0 };
    const settled = await settleFence(gl as unknown as WebGL2RenderingContext, fence as unknown as { sync: WebGLSync; started: number; polls: number },
      () => new Promise<void>(resolve => setTimeout(resolve, 0)));

    const counters = emptyRenderCounters(), source = { fieldId: 1, fieldKey: 'julia', jobId: 2, sceneRevision: 3, contextGeneration: 4,
      arithmetic: 'float32', iterations: 64, width: 19, height: 13, submittedAt: 100 };
    const events = new RenderEvents(() => 100), samples = new RenderEventSamples(100, counters);
    for (const type of ['field-submitted', 'field-ready', 'presentation'] as const) {
      const event = events.emit(type, source, type === 'presentation' ? { presentation: 'cache' } : {}); samples.add(event);
    }
    samples.add(events.emit('field-cancelled', source));
    samples.close(110, counters);
    const endBoundary = events.emit('field-ready', source); samples.add({ ...endBoundary, timestamp: 110 });
    const measurement = samples.result(true); events.dispose();
    return { calls, deleted, settled, measurement, method: (await import(benchmarkPath)).BENCHMARK_METHOD };
  });
  expect(result.calls).toHaveLength(2);
  expect(result.calls.every(call => call[2] === 0)).toBe(true);
  expect(result.deleted).toBe(1);
  expect(result.settled.polls).toBe(1);
  expect(result.method).toBe('fractol-navigation-v6-events');
  expect(result.measurement.eventSamples).toBe(4);
  expect(result.measurement.completedFields).toBe(1);
  expect(result.measurement.cancelledFields).toBe(1);
  expect(result.measurement.presentations.cache).toBe(1);
});
