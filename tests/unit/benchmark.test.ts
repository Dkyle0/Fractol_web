import { afterEach, describe, expect, it, vi } from 'vitest';
import { benchmarkCases, benchmarkScene, BenchmarkSamples, percentile, BENCHMARK_TIMING, type BenchmarkReport } from '../../src/domain/benchmark';
import { benchmarkMarkdown, benchmarkFilename } from '../../src/domain/benchmarkMarkdown';
import { browserFromUA, collectDeviceInfo } from '../../src/infrastructure/device';
import { createScene } from '../../src/domain/catalog';
import { computeViewingPlan, viewingScene } from '../../src/domain/viewing';
import { emptyRenderCounters, type FieldEventSource } from '../../src/domain/renderEvents';
import { RenderEvents } from '../../src/rendering/renderEvents';
import { RenderEventSamples } from '../../src/domain/renderEventSamples';

describe('benchmark methodology', () => {
  it('counts completed computations rather than partial or repeated presentations', () => {
    const samples = new BenchmarkSamples(0, 0), scene = createScene();
    const stats = { scale: .5, width: 20, height: 20, gpuSampleId: 0, gpuMs: null, computations: 0 };
    for (let timestamp = 1; timestamp <= 3; timestamp++) samples.add({ timestamp, stats: { ...stats, presentationKind: 'computed' } });
    samples.add({ timestamp: 4, stats: { ...stats, computations: 2, presentationKind: 'reprojection' } });
    samples.add({ timestamp: 5, stats: { ...stats, computations: 2, presentationKind: 'repeat' } });
    const result = samples.result({ scene, lightGlass: false }, 1000, false, 'completed');
    expect(result).toMatchObject({ completedFields: 2, newFieldsPerSecond: 2, presentations: { computed: 3, reprojection: 1, repeat: 1 } });
  });
  it('uses six standard variants and two independent current-scene snapshots', () => {
    const scene = createScene('buffalo'); scene.iterations = 1024;
    const standard = benchmarkCases({ mode: 'standard', scene }); expect(standard).toHaveLength(6); expect(standard.every(t => t.scene.iterations === 512)).toBe(true);
    const current = benchmarkCases({ mode: 'current', scene }); expect(current).toHaveLength(2); expect(current[0]!.scene.iterations).toBe(1024);
    current[0]!.scene.camera.x = 5; expect(current[1]!.scene.camera.x).toBe(scene.camera.x);
    expect(benchmarkScene(scene, 0)).toEqual(scene); expect(benchmarkScene(scene, 1000)).toEqual(benchmarkScene(scene, 1000));
  });
  it('counts unique GPU samples and actual frame intervals without mutation', () => {
    const samples = new BenchmarkSamples(5);
    samples.addGpu({ id: 5, ms: 3, submittedAt: 0, width: 1248, height: 702, kind: 'preview' });
    samples.addGpu({ id: 6, ms: 3, submittedAt: 10, width: 1248, height: 702, kind: 'preview' });
    samples.addGpu({ id: 6, ms: 3, submittedAt: 10, width: 1248, height: 702, kind: 'preview' });
    const stats = { scale: .65, width: 1248, height: 702, gpuSampleId: 5, gpuMs: 3,executor:'double-single-tiled',previewGenerator:'switch' };
    samples.add({ timestamp: 0, stats }); samples.add({ timestamp: 10, stats: { ...stats, gpuSampleId: 6 } }); samples.add({ timestamp: 30, stats: { ...stats, gpuSampleId: 6 } });
    samples.add({ timestamp: 30, stats }); samples.add({ timestamp: 60, stats: { ...stats, gpuSampleId: 7, gpuMs: null,previewGenerator:'structured' } });
    const result = samples.result({ scene: createScene(), lightGlass: false }, 1000, true, 'completed');
    expect(result).toMatchObject({ frames: 4, updatesPerSecond: 4, gpuSamples: 1, p50GpuMs: 3, p95FrameMs: 30, glassReduced: true, resolutions: ['1248×702'],executors:['double-single-tiled'],previewGenerators:['switch','structured'] });
    expect(result.frameIntervalsMs).toBeUndefined();
    const diagnostic = samples.result({ scene: createScene(), lightGlass: false }, 1000, false, 'completed', true);
    expect(diagnostic.frameIntervalsMs).toEqual([10, 20, 30]); expect(diagnostic.gpuTimesMs).toEqual([3]);
    diagnostic.gpuTimesMs!.push(999);
    expect(samples.result({ scene: createScene(), lightGlass: false }, 1000, false, 'completed', true).gpuTimesMs).toEqual([3]);
    expect(percentile([], .95)).toBeNull(); const numbers = [3, 1, 2]; expect(percentile(numbers, .5)).toBe(2); expect(numbers).toEqual([3, 1, 2]);
  });
  it('exports readable Markdown with withheld metadata, comments and reproducible scenes', () => {
    const report: BenchmarkReport = { version: 1, appVersion: '1.2.0', qualityProfile: 'performance', method: 'test', startedAt: '2026-10-18T12:00:00Z', timeZone: 'Europe/Moscow', mode: 'current', status: 'interrupted', reason: 'Вкладка скрыта', timing: BENCHMARK_TIMING, panels: 'Каталог', device: { browser: 'Firefox', userAgent: 'test', platform: 'Win32', architecture: null, model: null, logicalProcessors: 4, memoryGiB: null, viewport: { width: 1000, height: 800, dpr: 1 }, screen: { width: 1920, height: 1080 }, webgl: { renderer: 'Hidden', vendor: 'Hidden', gpuTimer: false, parallelCompile: false, maxTextureSize: 4096, version: 'WebGL 2', shadingLanguage: 'GLSL' } }, comment: 'От сети\n<script>x</script> | test', deviceLabel: 'Ноутбук', processorLabel: 'CPU', results: [new BenchmarkSamples().result({ scene: createScene(), lightGlass: false }, 0, false, 'interrupted')] };
    const md = benchmarkMarkdown(report);
    expect(md).toContain('Профиль качества | Плавность');
    expect(md).toContain('Недоступно'); expect(md).toContain('введено вручную'); expect(md).toContain('> От сети'); expect(md).not.toContain('<script>'); expect(md).toContain('```json'); expect(md).toContain('Вкладка скрыта'); expect(md).not.toContain('NaN'); expect(benchmarkFilename(report)).toMatch(/^fractol-benchmark-2026-10-18-\d{6}\.md$/);
    report.arithmeticVersion='binary64-u32-v1';
    report.results[0]!.arithmeticModes=['double-single-preview-v1'];
    report.results[0]!.presentations={computed:3,reprojection:5,repeat:7};
    report.results[0]!.precision={arithmetic:'binary64-u32-v1',status:'completed',reason:'',durationMs:2000,computeResolution:'100×80',displayResolution:'1000×800',scene:createScene(),gpuSamples:1,p50GpuMs:3,p95GpuMs:3,executor:'queue',preparationMs:25,waitMs:1500,submittedSlices:20,maxQueuedSlices:2};
    const extended=benchmarkMarkdown(report);
    expect(extended).toContain('новое поле 3, перепроекция 5, повторное предъявление 7');
    expect(extended).toContain('Исполнитель точного поля: queue');expect(extended).toContain('подготовка 25.00');
    expect(extended).toContain('не является отдельным GPU-временем');expect(extended).toContain('вывод 1000×800');
    expect(extended).toContain('Вариант ядра: Недоступно');
    report.results[0]!.precision.kernelVariant='binary64-u32-v2:reciprocal';
    report.results[0]!.precision.kernelFallback='probe <failed> | reference';
    const selected=benchmarkMarkdown(report);
    expect(selected).toContain('Вариант ядра: binary64-u32-v2:reciprocal');
    expect(selected).toContain('Резервный путь: probe &lt;failed&gt; \\| reference');
    expect(selected).not.toContain('<failed>');

    const source: FieldEventSource = { fieldId: 11, fieldKey: 'julia-key', jobId: 2, sceneRevision: 3, contextGeneration: 4,
      arithmetic: 'float32', iterations: 64, width: 19, height: 13, submittedAt: 100 };
    const renderEvents = new RenderEvents(() => 100), window = new RenderEventSamples(100, emptyRenderCounters());
    window.add(renderEvents.emit('field-submitted', source));
    window.add(renderEvents.emit('field-ready', source));
    window.add(renderEvents.emit('presentation', source, { presentation: 'cache' }));
    window.add(renderEvents.emit('tile-published', source, { tile: { x: 2, y: 3, width: 5, height: 7 } }));
    window.add(renderEvents.emit('field-cancelled', { ...source, fieldId: 12, jobId: 3 }, { reason: 'stale-revision' }));
    window.close(200, renderEvents.snapshot());
    window.addGpu({ id: 1, submittedAt: 150, ms: 2, kind: 'preview', width: 19, height: 13 });
    report.method = 'fractol-navigation-v6-events';
    report.results[0]!.measurement = window.result(true);
    const v6 = benchmarkMarkdown(report);
    expect(v6).toContain('## Данные измерений');
    expect(v6).toContain('"cachePolicy":"bypass"');
    expect(v6).toContain('"events":[[1,100,"field-submitted",11,null]');
    expect(v6).toContain('"gpu":[[1,150,2]]');
    expect(v6).toContain('"fields":[{"fieldId":11,"fieldKey":"julia-key","jobId":2,"sceneRevision":3,"contextGeneration":4,"arithmetic":"float32","iterations":64,"width":19,"height":13,"submittedAt":100}');
    expect(v6).toContain('"tile":{"x":2,"y":3,"width":5,"height":7}');
    expect(v6).toContain('"reason":"stale-revision"');
    expect(v6).toContain('Событие: [id, timestamp, type, fieldId, presentation]');
    expect(v6).toContain('Максимальная задержка от отправки поля до наблюдения готовности 0.00 мс');
    renderEvents.dispose();
  });
  it('includes the viewing iteration limit and effective viewing scene in v2 Markdown', () => {
    const scene = createScene(); scene.iterations = 2048; scene.camera.height = 1e-10;
    const calculated = computeViewingPlan(scene, { width: 960, height: 540 }, 1, { interactive: true });
    const view = { ...calculated, effectiveIterations: 512 };
    const legacyViewingScene = viewingScene(scene, view);
    const report: BenchmarkReport = { version: 1, appVersion: '1.4.0', qualityProfile: 'auto', method: 'fractol-navigation-v2-viewing', startedAt: '2026-10-18T12:00:00Z', timeZone: 'Europe/Moscow', mode: 'current', status: 'completed', reason: '', timing: BENCHMARK_TIMING, panels: 'hidden', device: { browser: 'test', userAgent: 'test', platform: 'test', architecture: null, model: null, logicalProcessors: null, memoryGiB: null, viewport: { width: 960, height: 540, dpr: 1 }, screen: { width: 1920, height: 1080 }, webgl: { renderer: 'Hidden', vendor: 'Hidden', gpuTimer: false, parallelCompile: false, maxTextureSize: 4096, version: 'WebGL 2', shadingLanguage: 'GLSL' } }, comment: '', deviceLabel: '', processorLabel: '', results: [{ ...new BenchmarkSamples().result({ scene, lightGlass: false }, 1000, false, 'completed'), effectiveIterations: [view.effectiveIterations], viewingScene: legacyViewingScene }] };
    const markdown = benchmarkMarkdown(report);
    expect(markdown).toContain(`фактические итерации ${view.effectiveIterations}`);
    expect(markdown).toContain(`"height": ${JSON.stringify(view.camera.height)}`);
    expect(markdown).toContain('"iterations": 512');
  });
  it('distinguishes browsers and keeps an honest unknown fallback', () => {
    expect(browserFromUA('Chrome/155.0 Edg/155.1')).toBe('Microsoft Edge 155.1'); expect(browserFromUA('Firefox/157.0')).toBe('Firefox 157.0'); expect(browserFromUA('Version/27.0 Safari/605')).toBe('Safari 27.0'); expect(browserFromUA('unknown')).toContain('не определён');
  });
  it('reports the actual field rather than the pending requested resolution',()=>{
    const samples=new BenchmarkSamples();samples.add({timestamp:1,stats:{scale:.5,width:960,height:540,computeWidth:480,computeHeight:270,gpuSampleId:0,gpuMs:null}});
    expect(samples.result({scene:createScene(),lightGlass:false},10,false,'completed').resolutions).toEqual(['480×270']);
  });
});
describe('device information with privacy restrictions', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses Navigator when Client Hints are withheld without inventing hardware details', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Firefox/157.0', platform: 'Win32', hardwareConcurrency: 8, userAgentData: { getHighEntropyValues: () => Promise.reject(new Error('Policy')) } });
    vi.stubGlobal('screen', { width: 1920, height: 1080 }); vi.stubGlobal('innerWidth', 900); vi.stubGlobal('innerHeight', 800); vi.stubGlobal('devicePixelRatio', 2);
    const result = await collectDeviceInfo({ renderer: 'Hidden', vendor: 'Generic', version: 'WebGL2', shadingLanguage: 'GLSL', maxTextureSize: 4096, gpuTimer: false, parallelCompile: false });
    expect(result).toMatchObject({ browser: 'Firefox 157.0', model: null, architecture: null, memoryGiB: null, logicalProcessors: 8, viewport: { width: 900, height: 800, dpr: 2 }, webgl: { gpuTimer: false } });
  });
});
