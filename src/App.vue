<script setup lang="ts">
import { ref, shallowRef, markRaw, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useExplorer } from './stores/explorer';
import { decodeScene, encodeScene } from './domain/scene';
import { copyScene, type SceneState } from './domain/types';
import { progressLabel } from './domain/precisionSlices';
import type { SessionStats } from './rendering/session';
import { fractals, getFractal } from './domain/catalog';
import Icon from './components/Icon.vue';
import FractalCanvas from './components/FractalCanvas.vue';
import CatalogPanel from './components/CatalogPanel.vue';
import ControlsPanel from './components/ControlsPanel.vue';
import CollectionPanel from './components/CollectionPanel.vue';
import BenchmarkPanel from './components/BenchmarkPanel.vue';
import ParameterInput from './components/ParameterInput.vue';
import { readPreferences, writePreferences } from './infrastructure/preferences';
import { BenchmarkRunner, type BenchmarkProgress } from './rendering/benchmarkRunner';
import type { BenchmarkConfig, BenchmarkReport } from './domain/benchmark';
import { useWorkspaceLayout } from './composables/useWorkspaceLayout';
import type { WorkspacePanel } from './domain/workspace';
import { qualityProfiles, type QualityProfile } from './domain/quality';
import { renderSize } from './domain/camera';
import {resolveResourceMode,type ResourcePreference,type ResourceMode} from './domain/resources';
import {mobileDeviceHint} from './infrastructure/mobile';
const store = useExplorer();
const stage = ref<InstanceType<typeof FractalCanvas>>();
const workspace = useWorkspaceLayout(window.innerWidth);
const { width, catalogOpen, controlsOpen, immersive } = workspace;
const directionPad = ref(false);
const restoredPreferences = readPreferences();
const mobileHint=mobileDeviceHint();
const resourcePreference=ref<ResourcePreference>(restoredPreferences.preferences.resourceMode??'auto');
const benchmarkResource=ref<ResourceMode|null>(null);
const resourceMode=computed(()=>benchmarkResource.value??resolveResourceMode(resourcePreference.value,mobileHint));
const resourceOptions={auto:'Автоматически',standard:'Обычный',economy:'Экономный'} as const;
function setResourcePreference(value:ResourcePreference){if(!store.locked)resourcePreference.value=value;}
const manualQuality = ref<QualityProfile>(restoredPreferences.preferences.qualityProfile), benchmarkQuality = ref<QualityProfile | null>(null);
const qualityProfile = computed(() => benchmarkQuality.value ?? manualQuality.value);
const exportSize = ref(renderSize({ width: innerWidth, height: innerHeight }, devicePixelRatio || 1));
const manualLight = ref(restoredPreferences.preferences.lightGlass), automaticLight = ref(false), benchmarkLight = ref<boolean | null>(null);
const lightGlass = computed(() => benchmarkLight.value ?? (resourceMode.value==='economy'||manualLight.value || (qualityProfile.value !== 'quality' && automaticLight.value)));
const dialog = ref<'save' | 'collection' | 'export' | 'about' | 'settings' | 'benchmark' | null>(null);
const dialogName = computed(() => dialog.value ? ({ save: 'Сохранение сцены', collection: 'Моя коллекция', export: 'Сохранить изображение', about: 'О приложении и управлении', settings: 'Оформление и качество', benchmark: 'Бенчмарк' })[dialog.value] : undefined);
let pendingNavigation: SceneState | null = null;
function applyPendingNavigation() {
  if (store.locked || !pendingNavigation) return;
  const scene = pendingNavigation; pendingNavigation = null;
  keepDialogOpener = false;
  store.update(scene); store.setJuliaPointer(false); dialog.value = null;
}
const benchmarkRunning = ref(false), benchmarkProgress = shallowRef<BenchmarkProgress | null>(null), benchmarkReport = ref<BenchmarkReport | null>(null);
let benchmarkRunner: BenchmarkRunner | undefined;
const benchmarkStop = ref<HTMLButtonElement>();
const extraMenu = ref(false);
function setManualLight(value: boolean) { manualLight.value = value; automaticLight.value = false; }
function toggleLight() { setManualLight(!lightGlass.value); }
function setQuality(profile: QualityProfile) { if (!store.locked && manualQuality.value !== profile) { manualQuality.value = profile; automaticLight.value = false; } }
const saveName = ref(''), exporting = ref(false), fullHd = ref(false);
const exportProgress = ref(0);
const exportIterations = ref(store.scene.iterations);
const exportKind=ref<'viewing'|'exact'>('exact');
let exportAbort: AbortController | undefined;
const stats = ref<SessionStats | null>(null);
const diagnostics = ref(new URLSearchParams(location.search).has('debug') || restoredPreferences.preferences.diagnostics);
const diagnosticData=shallowRef({presentations:0,fields:0,tiles:0,restores:0,cacheBytes:0,cacheEntries:0,cacheUnavailable:false});
function refreshDiagnosticData(){
  const session=stage.value?.getSession();if(!session)return;
  const counters=session.getRenderCounters(),memory=session.getMemoryEstimate();
  diagnosticData.value={presentations:Object.values(counters.presentations).reduce((sum,count)=>sum+count,0),
    fields:counters.readyFields,tiles:counters.publishedTiles,restores:counters.restoredFields,
    cacheBytes:memory.previewCacheBytes??0,cacheEntries:memory.previewCacheEntries??0,cacheUnavailable:memory.previewCacheUnavailable??false};
}
function receiveStats(value:SessionStats){stats.value=value;if(diagnostics.value)refreshDiagnosticData();}
watch(diagnostics,enabled=>{if(enabled)refreshDiagnosticData();});
const gpuSampleLabel=computed(()=>stats.value?.gpuSample?.kind==='color'?'цвет':stats.value?.gpuSample?.kind==='preview'?'просмотр':stats.value?.gpuSample?.kind==='precision'?'PNG':'нет образца');
watch([manualLight, diagnostics, manualQuality,resourcePreference], ([lightGlass, diagnostics, qualityProfile,resourceMode]) => { if (!writePreferences({ version: 1, lightGlass, diagnostics, qualityProfile,resourceMode })) store.notify('Браузер не сохранил настройки оформления.'); });
if (restoredPreferences.warning) store.notify(restoredPreferences.warning,true);
let dialogOpener: HTMLElement | null = null;
let clickedOpener: HTMLElement | null = null;
let keepDialogOpener = false;
let restoreFocusTimer: ReturnType<typeof setTimeout> | undefined;
function rememberDialogOpener(event: MouseEvent) {
  if (!dialog.value && !benchmarkRunning.value) clickedOpener = (event.target as Element).closest<HTMLElement>('button, a, [role="button"]');
}
watch(dialog, (next, previous) => {
  clearTimeout(restoreFocusTimer);
  if (next === 'export' && previous !== 'export'){exportIterations.value=store.scene.iterations;exportKind.value=resourceMode.value==='economy'?'viewing':'exact';}
  if (next && !previous && !benchmarkRunning.value && !keepDialogOpener) dialogOpener = clickedOpener?.isConnected ? clickedOpener : document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (next) keepDialogOpener = false;
  if (!next && previous && !benchmarkRunning.value) {
    const opener = dialogOpener, focusAtClose = document.activeElement;
    restoreFocusTimer = setTimeout(() => {
      const active = document.activeElement;
      // A user may already have chosen another field while the dialog fades out.
      const movedFocus = active && active !== document.body && active !== focusAtClose && !active.closest('[role="dialog"]');
      if (!dialog.value && !benchmarkRunning.value && opener?.isConnected && !movedFocus) opener.focus({ preventScroll: true });
    }, 220);
  }
});
async function startBenchmark(mode: BenchmarkConfig['mode'], includeSamples = false) {
  const scheduler = stage.value?.getSession();
  if (!scheduler || benchmarkRunning.value) return;
  keepDialogOpener = true;
  store.setJuliaPointer(false); store.commitAction();
  const snapshot = copyScene(store.scene), layout = workspace.snapshot(), previousDirection = directionPad.value, previousAutomaticLight = automaticLight.value;
  const testQuality = mode === 'standard' ? 'auto' : manualQuality.value;
  benchmarkQuality.value = testQuality;benchmarkResource.value=mode==='standard'?'standard':resourceMode.value;
  store.locked = true; benchmarkRunning.value = true; extraMenu.value = false; dialog.value = null; directionPad.value = false;
  workspace.enterBenchmark();
  benchmarkRunner = new BenchmarkRunner(scheduler, {
    panels: width.value >= 1280 ? 'Каталог и параметры' : width.value >= 768 ? 'Каталог' : 'Панели закрыты (мобильный экран)',
    apply: async test => { benchmarkLight.value = test.lightGlass; automaticLight.value = false; store.transient(test.scene); await nextTick(); },
    move: scene => store.transient(scene), isLight: () => lightGlass.value,
    progress: value => { benchmarkProgress.value = value; },
  });
  await nextTick(); benchmarkStop.value?.focus();
  try { const report=await benchmarkRunner.run({ mode, scene: snapshot, qualityProfile: testQuality,resourceMode:benchmarkResource.value??undefined, includeSamples });markRaw(report.results);benchmarkReport.value=report; }
  catch (cause) { store.notify(cause instanceof Error ? cause.message : 'Не удалось запустить бенчмарк.'); }
  finally {
    benchmarkRunner = undefined; store.transient(snapshot); benchmarkLight.value = null; benchmarkQuality.value = null;benchmarkResource.value=null; automaticLight.value = previousAutomaticLight;
    workspace.restore(layout, window.innerWidth); directionPad.value = previousDirection;
    store.locked = false; benchmarkRunning.value = false; benchmarkProgress.value = null; dialog.value = 'benchmark';
    applyPendingNavigation();
    await nextTick();
  }
  return benchmarkReport.value;
}
const snackbar = computed({ get: () => !!store.notification, set: value => { if (!value) store.dismissNotification(); } });
const zoomValue = computed(() => getFractal(store.scene.fractalId).presets[0].camera.height / (stats.value?.viewing.camera.height ?? store.scene.camera.height));
const scaleLabel = computed(() => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, ...(zoomValue.value >= 10000 ? { notation: 'compact' as const } : {}) }).format(zoomValue.value) + '×');
const fullScaleLabel = computed(() => zoomValue.value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '×');
function focusPanelTrigger(panel: WorkspacePanel) {
  [...document.querySelectorAll<HTMLElement>(`[data-panel-trigger="${panel}"]`)].find(el => el.getClientRects().length > 0)?.focus({ preventScroll: true });
}
async function togglePanel(panel: WorkspacePanel) {
  if (store.locked) return;
  workspace.togglePanel(panel); await nextTick();
  if (panel === 'controls' && controlsOpen.value) document.querySelector<HTMLElement>('.parameters-heading-button')?.focus({ preventScroll: true });
  else if (panel === 'controls') focusPanelTrigger(panel);
}
async function closePanel(panel: WorkspacePanel) {
  if (store.locked) return;
  workspace.closePanel(panel); await nextTick();
  focusPanelTrigger(panel);
}
async function toggleInterface() {
  if (store.locked) return;
  const focused = document.activeElement;
  extraMenu.value = false; workspace.setImmersive(!immersive.value); await nextTick();
  if (focused && !focused.isConnected) document.querySelector<HTMLElement>('.interface-toggle')?.focus({ preventScroll: true });
}
function toggleDirections() { if (!store.locked) directionPad.value = !directionPad.value; }
function resize() { workspace.resize(window.innerWidth); exportSize.value = renderSize({ width: innerWidth, height: innerHeight }, devicePixelRatio || 1); }
function openSave() { saveName.value = store.definition.name; dialog.value = 'save'; }
function save() { if (!saveName.value.trim()) return; store.save(saveName.value); dialog.value = null; if (!store.notification) store.notify('Сцена добавлена в вашу коллекцию.'); }
async function copyLink() {
  const url = new URL(location.href); url.hash = encodeScene(store.scene);
  try { await navigator.clipboard.writeText(url.href); history.replaceState(null, '', url.href); store.notify('Ссылка на сцену скопирована.'); }
  catch { history.replaceState(null, '', url.href); store.notify('Ссылка готова в адресной строке. Скопируйте её оттуда.'); }
}
async function download() {
  if (!stage.value || exporting.value) return;
  exporting.value = true; store.locked = true; exportProgress.value = 0; exportAbort = new AbortController();
  const name = store.scene.fractalId;
  try {
    let lastProgress = -Infinity;
    const blob = exportKind.value==='viewing'?await stage.value.exportViewing(exportAbort.signal):await stage.value.exportPng(fullHd.value, exportAbort.signal, value => { if (performance.now()-lastProgress>=250 || value===1) { exportProgress.value=value; lastProgress=performance.now(); } }, exportIterations.value);
    exportAbort.signal.throwIfAborted();
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `fractol-${name}${exportKind.value==='viewing'?'-view':''}.png`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    dialog.value = null; store.notify('Изображение сохранено в PNG.');
  } catch (cause) { if (!pendingNavigation) store.notify(cause instanceof Error ? cause.message : 'Не удалось экспортировать изображение.'); }
  finally { exporting.value = false; store.locked = false; exportAbort = undefined; applyPendingNavigation(); }
}
function hashChange() {
  const scene = decodeScene(location.hash);
  if (!scene) { if (location.hash) store.notify('Ссылка на сцену повреждена или не поддерживается.'); return; }
  pendingNavigation = copyScene(scene);
  if (benchmarkRunning.value) benchmarkRunner?.stop('Открыта другая ссылка на сцену.');
  if (exporting.value) exportAbort?.abort(new Error('Открыта другая ссылка на сцену.'));
  applyPendingNavigation();
}
function lightFallback() { if (benchmarkRunning.value) { benchmarkLight.value = true; return; } automaticLight.value = true; store.notify('Включено лёгкое стекло для более плавной навигации. Эффекты можно вернуть в настройках.'); }
const overlayEscapes = new WeakSet<KeyboardEvent>();
function overlayShortcuts(event: KeyboardEvent) {
  if (event.key !== 'Escape' || (!extraMenu.value && !dialog.value)) return;
  overlayEscapes.add(event);
  event.preventDefault(); event.stopImmediatePropagation();
  if (extraMenu.value) {
    extraMenu.value = false;
    void nextTick(() => document.querySelector<HTMLElement>('.more-actions')?.focus({ preventScroll: true }));
  } else if (exporting.value) exportAbort?.abort(new Error('Экспорт отменён.')); else dialog.value = null;
}
function shortcuts(event: KeyboardEvent) {
  if (store.locked || overlayEscapes.has(event) || dialog.value || extraMenu.value) return;
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, select, [role="dialog"], [contenteditable="true"]')) return;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
    event.preventDefault(); if (event.key.toLowerCase() === 'y' || event.shiftKey) store.redo(); else store.undo(); return;
  }
  if (event.key === 'Escape') { workspace.setImmersive(false); store.setJuliaPointer(false); }
  if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); toggleInterface(); }
  if (event.key === '/') { event.preventDefault(); workspace.openPanel('catalog'); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Найти фрактал"]')?.focus()); }
}
// Only exposed in the development server or with ?debug=1, for repeatable diagnostics.
declare global { interface Window { __FRACTOL__?: {
  scene: () => SceneState; setScene: (scene: SceneState) => void; stats: () => unknown; renderer: () => unknown;
  viewing: () => import('./domain/viewing').ViewingState | undefined; adoptOverview: () => void;
  benchmark: (mode: BenchmarkConfig['mode'], includeSamples?: boolean) => Promise<BenchmarkReport | null | undefined>; select: (id: SceneState['fractalId']) => void; glass: (enabled: boolean) => void; pan: (dx: number, dy: number) => void;
} } }
onMounted(() => {
  window.addEventListener('resize', resize); window.addEventListener('hashchange', hashChange); window.addEventListener('keydown', shortcuts);
  window.addEventListener('keydown', overlayShortcuts, true);
  if (import.meta.env.DEV || diagnostics.value) window.__FRACTOL__ = {
    scene: () => copyScene(store.scene), setScene: scene => { const next = decodeScene(encodeScene(scene)); if (next) store.update(next); },
    stats: () => stage.value?.getSession()?.getStats(), viewing:()=>stage.value?.getViewState(), adoptOverview:()=>stage.value?.adoptOverview(), renderer: () => stage.value?.getDiagnostics(),
    benchmark: startBenchmark, select: store.select, glass: enabled => { setManualLight(!enabled); }, pan: (dx, dy) => stage.value?.pan(dx, dy),
  };
});
onBeforeUnmount(() => { exportAbort?.abort(); clearTimeout(restoreFocusTimer); benchmarkRunner?.stop('Приложение закрыто.'); store.commitAction(); window.removeEventListener('resize', resize); window.removeEventListener('hashchange', hashChange); window.removeEventListener('keydown', shortcuts); window.removeEventListener('keydown', overlayShortcuts, true); delete window.__FRACTOL__; });
</script>
<template>
  <v-app><main class="laboratory" :class="{ 'light-glass': lightGlass, immersive }" @click.capture="rememberDialogOpener">
    <FractalCanvas ref="stage" :light-glass="lightGlass" :resource-mode="resourceMode" :quality-profile="qualityProfile" :keyboard-blocked="!!dialog || extraMenu" @stats="receiveStats" @light-glass="lightFallback" />
    <div class="vignette" aria-hidden="true" />
    <header :inert="store.locked" v-if="!immersive" class="topbar glass">
      <a class="brand" href="#" aria-label="Fractol — начальная сцена" @click.prevent="store.select('mandelbrot')"><span class="brand-symbol">ƒ<span>·</span></span><span>fractol<span class="brand-version">LAB</span></span></a>
      <nav class="main-nav" aria-label="Основная навигация"><button class="active" @click="dialog = null"><Icon name="shape" :size="17" />Исследовать</button><button @click="dialog = 'collection'"><Icon name="save" :size="17" />Моя коллекция<span v-if="store.library.scenes.length" class="nav-count">{{ store.library.scenes.length }}</span></button></nav>
      <div class="header-actions"><v-btn variant="text" class="icon-button" aria-label="О приложении и управлении" title="Об управлении" @click="dialog = 'about'"><Icon name="help" /></v-btn><v-btn variant="text" class="icon-button mobile-collection" aria-label="Открыть мою коллекцию" @click="dialog = 'collection'"><Icon name="saved" :size="18" /></v-btn><v-btn variant="text" class="icon-button appearance-button" aria-label="Оформление" title="Оформление" @click="dialog = 'settings'"><Icon name="settings" /><span class="appearance-label">Оформление</span></v-btn><span class="header-divider" /><v-btn class="save-button" variant="text" aria-label="Сохранить" @click="openSave"><Icon name="save" :size="17" /><span>Сохранить</span></v-btn><v-btn class="export-button" color="primary" :aria-label="stats?.viewing.overview ? 'Экспорт исходного кадра' : 'Экспорт PNG'" @click="dialog = 'export'"><Icon name="download" :size="17" /><span>{{ stats?.viewing.overview ? 'Экспорт исходного кадра' : 'Экспорт PNG' }}</span></v-btn></div>
    </header>
    <div v-if="!immersive" class="scene-caption"><span class="eyebrow">ГЕОМЕТРИЯ БЕСКОНЕЧНОСТИ</span><h1>{{ store.definition.name }}</h1><span class="scene-subtitle">{{ store.definition.subtitle }}</span></div>
    <div id="fractal-catalog"><Transition name="panel-left"><CatalogPanel :inert="store.locked" v-if="catalogOpen && !immersive" @close="closePanel('catalog')" /></Transition></div>
    <button v-if="!immersive && !controlsOpen && width >= 768" class="parameters-toggle glass" :inert="store.locked" data-panel-trigger="controls" aria-label="Параметры" aria-expanded="false" aria-controls="fractal-parameters" @click="togglePanel('controls')"><Icon name="previous" :size="19" /><span>Параметры</span></button>
    <div id="fractal-parameters"><Transition name="panel-right"><ControlsPanel :economy="resourceMode === 'economy'" :overview="!!stats?.viewing.overview" v-if="controlsOpen && !immersive" @close="closePanel('controls')" @interact="stage?.getSession()?.interact()" /></Transition></div>
    <div v-if="store.juliaPointer && !immersive" class="pointer-hint glass"><Icon name="cursor" :size="16" />Указатель меняет константу Julia<button @click="store.setJuliaPointer(false)">Завершить</button></div>
    <div v-if="!immersive" class="bottom-hint"><Icon name="cursor" :size="14" /><span>Перетаскивайте для перемещения</span><i /> <span>Колесо — масштаб</span></div>
    <footer :inert="store.locked" class="bottom-bar">
      <div v-if="!immersive" class="render-status" role="status" data-testid="precision-status"><span class="status-dot" /><span>WEBGL2</span><span class="status-separator">/</span><span>Приближённый просмотр · {{ stats?.viewing.arithmetic === 'double-single' ? 'DS' : 'float32' }}</span></div>
      <nav class="navigation glass" aria-label="Навигация по фракталу">
        <div class="zoom-controls"><v-btn variant="text" class="icon-button" :disabled="!!stats?.viewing.overview" aria-label="Уменьшить масштаб" @click="stage?.zoom(1.35)"><Icon name="minus" :size="19" /></v-btn><span class="zoom-value" :title="fullScaleLabel" :aria-label="`Масштаб ${fullScaleLabel}`">{{ scaleLabel }}</span><v-btn variant="text" class="icon-button" :disabled="!!stats?.viewing.overview" aria-label="Увеличить масштаб" @click="stage?.zoom(1 / 1.35)"><Icon name="plus" :size="19" /></v-btn></div>
        <v-btn variant="text" class="icon-button camera-reset" :disabled="!!stats?.viewing.overview" aria-label="Сбросить камеру" title="Общий вид · Home" @click="store.reset"><Icon name="reset" :size="19" /></v-btn>
        <v-btn variant="text" class="interface-toggle nav-action" :aria-label="immersive ? 'Показать интерфейс' : 'Скрыть интерфейс'" :data-active="immersive" :title="`${immersive ? 'Показать' : 'Скрыть'} интерфейс · F`" @click="toggleInterface"><Icon :name="immersive ? 'eye' : 'eyeOff'" :size="18" /><span>{{ immersive ? 'Показать интерфейс' : 'Скрыть интерфейс' }}</span></v-btn>
        <div class="navigation-secondary">
        <v-btn variant="text" class="catalog-toggle nav-action" data-panel-trigger="catalog" aria-label="Каталог фракталов" :aria-expanded="catalogOpen && !immersive" aria-controls="fractal-catalog" @click="togglePanel('catalog')"><Icon name="grid" :size="18" /><span>Каталог</span></v-btn>
        <v-btn v-if="width < 768 || immersive" variant="text" class="parameters-nav nav-action" data-panel-trigger="controls" aria-label="Параметры" :aria-expanded="controlsOpen && !immersive" aria-controls="fractal-parameters" @click="togglePanel('controls')"><Icon name="tune" :size="18" /><span>Параметры</span></v-btn>
        <v-btn variant="text" class="icon-button mobile-share" aria-label="Поделиться сценой" @click="copyLink"><Icon name="link" :size="18" /></v-btn>
        <v-menu v-model="extraMenu"><template #activator="{ props }"><v-btn v-bind="props" variant="text" class="more-actions nav-action" title="Ещё" aria-label="Ещё" :aria-expanded="extraMenu"><Icon name="more" :size="18" /></v-btn></template><v-list class="extra-actions" role="menu" aria-label="Ещё"><v-list-item role="menuitem" :disabled="!store.canUndo" :aria-disabled="!store.canUndo" @click="store.undo">Отменить действие</v-list-item><v-list-item role="menuitem" :disabled="!store.canRedo" :aria-disabled="!store.canRedo" @click="store.redo">Повторить действие</v-list-item><v-list-item role="menuitemcheckbox" :aria-checked="directionPad" aria-controls="direction-pad" @click="toggleDirections">Перемещение по кнопкам</v-list-item></v-list></v-menu>
        </div>
      </nav>
      <div v-if="directionPad" id="direction-pad" class="direction-pad glass" aria-label="Направление перемещения"><button class="direction-up" aria-label="Сдвинуть вид вверх" @click="stage?.pan(0, 55)"><Icon name="up" /></button><button class="direction-left" aria-label="Сдвинуть вид влево" @click="stage?.pan(55, 0)"><Icon name="back" /></button><button class="direction-right" aria-label="Сдвинуть вид вправо" @click="stage?.pan(-55, 0)"><Icon name="right" /></button><button class="direction-down" aria-label="Сдвинуть вид вниз" @click="stage?.pan(0, -55)"><Icon name="down" /></button></div>
      <button v-if="!immersive" class="share-link" aria-label="Поделиться сценой" @click="copyLink"><Icon name="link" :size="15" /><span>Поделиться сценой</span></button>
    </footer>
    <div v-if="diagnostics && stats && !immersive" class="diagnostics glass" data-testid="diagnostics"><strong>Диагностика</strong><span>{{ stats.width }} × {{ stats.height }} · масштаб {{ stats.scale.toFixed(2) }}</span><span>Поле {{ stats.computeWidth }} × {{ stats.computeHeight }} · {{ stats.arithmetic }}</span><span>Отправок {{ diagnosticData.presentations }} · готовых полей {{ diagnosticData.fields }}</span><span>Тайлов {{ diagnosticData.tiles }} · из кэша {{ diagnosticData.restores }}</span><span>Кэш полей {{ (diagnosticData.cacheBytes / 1048576).toFixed(2) }} МиБ · {{ diagnosticData.cacheEntries }} записей</span><span v-if="diagnosticData.cacheUnavailable">Заполнение кэша отключено до восстановления контекста</span><span>GPU {{ stats.gpuMs?.toFixed(2) ?? 'нет данных' }} мс ({{ gpuSampleLabel }}) · rAF {{ stats.frameMs?.toFixed(1) ?? '—' }} мс</span><span>Итерации {{ stats.viewing.effectiveIterations }} / {{ stats.viewing.requestedIterations }} · {{ stats.viewing.ready ? 'готово' : 'обновление' }}</span></div>
    <div v-if="benchmarkRunning" class="benchmark-progress glass" role="status" aria-label="Бенчмарк выполняется"><div><strong>{{ benchmarkProgress?.phase || 'Подготовка теста' }}</strong><span>Вариант {{ (benchmarkProgress?.index ?? 0) + 1 }} / {{ benchmarkProgress?.total ?? '—' }}</span><progress :value="benchmarkProgress ? (benchmarkProgress.index + benchmarkProgress.fraction) / benchmarkProgress.total : 0" max="1" aria-label="Прогресс бенчмарка" /></div><button ref="benchmarkStop" @click="benchmarkRunner?.stop()">Остановить</button></div>
    <v-dialog :model-value="dialog !== null" :aria-label="dialogName" :max-width="dialog === 'benchmark' ? 780 : dialog === 'collection' ? 700 : 480" @update:model-value="value => { if (!value && !exporting) dialog = null; }">
      <section class="dialog-card glass" :class="{ 'light-glass': lightGlass }" :aria-label="dialog === 'save' ? 'Сохранение сцены' : 'Диалог'">
        <div v-if="exporting" class="export-progress" role="status"><p>{{ exportProgress === 0 ? (exportKind === 'viewing' ? 'Сохранение готового просмотра' : 'Подготовка точного PNG') : `Точный PNG · ${progressLabel(exportProgress)}` }}</p><progress :value="exportProgress" max="1" aria-label="Прогресс PNG" /><v-btn variant="tonal" @click="exportAbort?.abort(new Error('Экспорт отменён.'))">Отменить экспорт</v-btn></div>
        <button class="dialog-close" aria-label="Закрыть диалог" :disabled="exporting" @click="dialog = null"><Icon name="close" /></button>
        <template v-if="dialog === 'save'"><span class="eyebrow">ОСТАВЬТЕ СЕБЕ КООРДИНАТЫ</span><h2>Сохранить мгновение</h2><p>Формула, цвета и точка зрения останутся в вашей коллекции в этом браузере.</p><form @submit.prevent="save"><v-text-field v-model="saveName" label="Название сцены" variant="outlined" maxlength="80" autofocus hide-details /><v-btn color="primary" type="submit" block :disabled="!saveName.trim()" class="dialog-action">Сохранить сцену</v-btn></form></template>
        <CollectionPanel v-else-if="dialog === 'collection'" @close="dialog = null" />
        <BenchmarkPanel v-else-if="dialog === 'benchmark'" :report="benchmarkReport" :resource-mode="resourceMode" :quality-profile="manualQuality" :available="!!stats?.draws" @start="startBenchmark" />
        <template v-else-if="dialog === 'export'">
          <span class="eyebrow">БЕСКОНЕЧНОСТЬ В ОДНОМ КАДРЕ</span><h2>Сохранить изображение</h2>
          <fieldset class="quality-options" :disabled="exporting"><legend>Вариант PNG</legend>
            <label :class="{selected:exportKind==='viewing'}"><input type="radio" name="export-kind" value="viewing" v-model="exportKind" /><span><strong>{{ stats?.viewing.overview ? 'PNG обзора' : 'Быстрый — как в просмотре' }}</strong><small>Готовое приближённое поле, без повторного расчёта орбит.</small></span></label>
            <label :class="{selected:exportKind==='exact'}"><input type="radio" name="export-kind" value="exact" v-model="exportKind" /><span><strong>Точный — binary64</strong><small>Исходный кадр с отдельным пределом итераций. Может потребовать длительного ожидания.</small></span></label>
          </fieldset>
          <template v-if="exportKind==='viewing'">
            <p>Приближённый {{ stats?.viewing.overview ? 'обзор' : 'просмотр' }} · {{ stats?.computeWidth }} × {{ stats?.computeHeight }} · {{ stats?.viewing.effectiveIterations }} итераций. Сохраняются текущая палитра и фактическая камера просмотра.</p>
            <p v-if="!stats?.viewing.ready" role="status">Дождитесь готовности изображения. Быстрый экспорт не запускает новый расчёт.</p>
          </template>
          <template v-else>
            <p>PNG рассчитывается отдельно в binary64. Итерации экспорта не меняют просмотр; точное изображение может отличаться.</p>
            <div class="export-options"><button :class="{ active: fullHd }" :disabled="exporting" @click="fullHd = true"><Icon name="image" /><strong>Full HD</strong><span>1920 × 1080</span></button><button :class="{ active: !fullHd }" :disabled="exporting" @click="fullHd = false"><Icon name="expand" /><strong>Текущий размер</strong><span>{{ exportSize.width }} × {{ exportSize.height }}</span></button></div>
            <div class="complex-fields parameter-field" :inert="exporting"><ParameterInput :model-value="exportIterations" label="Итерации экспорта" accessible-label="Итерации экспорта" :min="64" :max="16384" :step="1" integer @update:model-value="exportIterations = $event" @invalid="store.notify('Итерации экспорта: целое число от 64 до 16384.')" /></div>
            <p class="small-note">До 16 384 итераций. Больший предел может увеличить время расчёта. Просмотр и сохранённая сцена не меняются.</p>
            <p class="small-note">{{ stats?.viewing.overview ? 'Будет экспортирован исходный участок, отмеченный в обзоре.' : 'Точный расчёт можно отменить.' }} Full HD сохраняет центр и вертикальный охват. Повторный точный PNG использует готовое поле.</p>
          </template>
          <v-btn color="primary" block class="dialog-action" :loading="exporting" :disabled="exportKind==='viewing' && !stats?.viewing.ready" @click="download">Скачать PNG</v-btn>
        </template>
        <template v-else-if="dialog === 'about'"><span class="eyebrow">FRACTOL LAB</span><h2>Пространство бесконечности</h2><p>{{ fractals.length }} математических миров, которые рождаются прямо в вашем браузере. Продолжение оригинального Fractol на C.</p><div class="help-keys"><span>Масштаб</span><kbd>Колесо / + −</kbd><span>Перемещение</span><kbd>Мышь / стрелки</kbd><span>Общий вид</span><kbd>Home</kbd><span>Скрыть интерфейс</span><kbd>F / Escape</kbd><span>Поиск</span><kbd>/</kbd><span>Жесты на экране</span><kbd>Касание / щипок</kbd></div><p class="small-note">Вычисления выполняются через WebGL2. Сцены хранятся на вашем устройстве. Глубина приближения ограничена точностью вычислений.</p></template>
        <template v-else-if="dialog === 'settings'">
          <span class="eyebrow">В КОМФОРТНОМ ТЕМПЕ</span><h2>Оформление и качество</h2>
          <fieldset class="quality-options"><legend>Режим ресурсов</legend><label v-for="(label,id) in resourceOptions" :key="id" :class="{selected:resourcePreference===id}"><input type="radio" name="resource-mode" :value="id" :checked="resourcePreference===id" :disabled="store.locked" @change="setResourcePreference(id)" /><span><strong>{{ label }}</strong></span></label></fieldset>
          <p class="small-note">Сейчас: {{ resourceMode==='economy'?'экономный — float32, до 512 итераций, 30 кадров/с, DPR 1 и 600 тыс. пикселей':'обычный — float32/DS и полное разрешение' }}. Автоопределение выполняется при запуске; размер окна не переключает режим.</p>
          <fieldset class="quality-options"><legend>Профиль качества</legend><label v-for="(profile, id) in qualityProfiles" :key="id" :class="{ selected: manualQuality === id }"><input type="radio" name="quality-profile" :value="id" :checked="manualQuality === id" :disabled="store.locked" @change="setQuality(id)" /><span><strong>{{ profile.name }}</strong><small>{{ profile.description }}</small></span></label></fieldset>
          <button class="toggle-row" :aria-pressed="lightGlass" :disabled="resourceMode==='economy'" @click="toggleLight"><span>Лёгкое стекло</span><span class="toggle" :class="{ on: lightGlass }" /></button><p class="small-note">{{ resourceMode==='economy'?'В экономном режиме размытие отключено. Ручное предпочтение сохранено.':'Убирает размытие, сохраняя прозрачность и блики.' }} Освобождает ресурсы для фрактала.</p>
          <button class="toggle-row" :aria-pressed="diagnostics" @click="diagnostics = !diagnostics"><span>Показать диагностику</span><span class="toggle" :class="{ on: diagnostics }" /></button><p class="small-note">{{ resourceMode==='economy'?'Экономный просмотр использует до 512 итераций, в том числе при движении.':'Обычный просмотр использует выбранное число итераций, в том числе при движении.' }} Подстраивается разрешение; после остановки возвращается итоговая чёткость выбранного режима. Точность binary64 доступна при экспорте PNG.</p>
          <v-btn variant="tonal" block class="dialog-action" @click="dialog = 'benchmark'"><Icon name="speed" :size="18" />Бенчмарк</v-btn><p v-if="stats" class="device-name">{{ stats.renderer }}</p><v-btn variant="text" class="dialog-action" block @click="dialog = 'about'">Управление и горячие клавиши</v-btn>
        </template>
      </section>
    </v-dialog>
    <v-snackbar v-model="snackbar" :timeout="store.notificationPersistent ? -1 : 4500" color="surface" location="bottom" class="notification">{{ store.notification }}<template #actions><v-btn variant="text" aria-label="Закрыть уведомление" @click="store.dismissNotification()"><Icon name="close" :size="18" /></v-btn></template></v-snackbar>
  </main></v-app>
</template>
