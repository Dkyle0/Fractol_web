<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useExplorer } from '../stores/explorer';
import { gestureCamera, panCamera, renderSize, screenToWorld, zoomAt } from '../domain/camera';
import type { QualityProfile } from '../domain/quality';
import { RenderSession, type SessionStats } from '../rendering/session';
import { createWebGLRuntime, type WebGLDiagnostics } from '../rendering/webgl/runtime';
import type { SceneState } from '../domain/types';
import type {ViewingState} from '../domain/viewing';
import type {ResourceMode} from '../domain/resources';
import { sceneMathKey } from '../domain/sceneIdentity';
const props = defineProps<{ lightGlass: boolean; qualityProfile: QualityProfile; resourceMode?:ResourceMode; keyboardBlocked?: boolean }>();
const emit = defineEmits<{ lightGlass: []; stats: [SessionStats] }>();
const store = useExplorer(), { scene, juliaPointer } = storeToRefs(store);
const canvas = ref<HTMLCanvasElement>();
const error = ref(''), loading = ref(true), lost = ref(false);
const progress = ref<{ phase: string; fraction: number;arithmetic:string } | null>(null);
const previewWarning=ref('');
const viewing=ref<ViewingState|null>(null);
const overview=computed(()=>!!viewing.value?.overview);
const regionStyle=computed(()=>{const ratio=viewing.value?viewing.value.requestedCamera.height/viewing.value.camera.height:1;return {width:`${Math.max(0.3,ratio*100)}%`,height:`${Math.max(0.3,ratio*100)}%`};});
const hasImage=ref(false);
let diagnostics: WebGLDiagnostics | undefined;
let scheduler: RenderSession | undefined, observer: ResizeObserver | undefined;
let view = { width: 1, height: 1 };
let disposed = false;
let limitNotification = 0;
let pendingJuliaKey: string | null = null;
const pointers = new Map<number, { x: number; y: number }>();
let dragging = false;
let gesture: { camera: SceneState['camera']; positions: { x: number; y: number }[] } | null = null;
function anchorGesture() { gesture = { camera: { ...scene.value.camera }, positions: [...pointers.values()].map(p => ({ ...p })) }; }
function changeCamera(camera: SceneState['camera']) {
  if (store.locked || overview.value) return;
  const bounded={...camera,x:Math.max(-20,Math.min(20,camera.x)),y:Math.max(-20,Math.min(20,camera.y))};
  const constrained=scheduler?.constrainCamera(bounded)??bounded;
  store.change({ camera: constrained }, pointers.size ? 'camera-gesture' : 'camera-navigation', !pointers.size);
  scheduler?.interact();
}
function zoom(factor: number, x = view.width / 2, y = view.height / 2) {
  if(overview.value)return;
  const state=scheduler?.getViewState();
  const next = zoomAt(scene.value.camera, view, x, y, factor,state?.numericalLimits,(scheduler?.getFinalSize()??renderSize(view,window.devicePixelRatio||1)).height);
  if (next.height <= (scheduler?.getViewState().minimumHeight??0) * 1.001 && performance.now() - limitNotification > 3000) {
    store.notify('Достигнут предел точности. Можно продолжить исследование перемещением.'); limitNotification = performance.now();
  }
  changeCamera(next);
}
function pan(dx: number, dy: number) { changeCamera(panCamera(scene.value.camera, view, dx, dy)); }
function point(event: PointerEvent | WheelEvent) {
  const rect = canvas.value!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function down(event: PointerEvent) {
  if (event.button !== 0 || store.locked || overview.value) return;
  canvas.value?.focus({ preventScroll: true }); canvas.value?.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, point(event)); dragging = true;
  anchorGesture();
}
function move(event: PointerEvent) {
  if (store.locked || overview.value) return;
  const current = point(event), previous = pointers.get(event.pointerId);
  if (juliaPointer.value && scene.value.fractalId === 'julia' && event.pointerType !== 'touch') {
    const world = screenToWorld(scene.value.camera, view, current.x, current.y);
    store.change({ parameters: { juliaRe: Math.max(-2, Math.min(2, world.x)), juliaIm: Math.max(-2, Math.min(2, world.y)) } }, 'julia-pointer');
    pendingJuliaKey=sceneMathKey(scene.value);
    scheduler?.interact(); return;
  }
  if (!previous || !dragging) return;
  pointers.set(event.pointerId, current);
  if (!gesture || pointers.size > 2) return;
  const center = (ps: { x: number; y: number }[]) => ({ x: ps.reduce((sum,p) => sum+p.x,0)/ps.length, y: ps.reduce((sum,p) => sum+p.y,0)/ps.length });
  const positions = [...pointers.values()], start = gesture.positions;
  const distance = (ps: typeof positions) => ps.length === 2 ? Math.hypot(ps[0]!.x-ps[1]!.x,ps[0]!.y-ps[1]!.y) : 1;
  const factor = pointers.size === 2 && distance(positions) > 2 && distance(start) > 2 ? distance(start)/distance(positions) : 1;
  changeCamera(gestureCamera(gesture.camera, view, center(start), center(positions), factor,scheduler?.getViewState().numericalLimits,(scheduler?.getFinalSize()??renderSize(view,window.devicePixelRatio||1)).height));
}
function up(event: PointerEvent) { if (!pointers.delete(event.pointerId)) return; dragging = pointers.size > 0; anchorGesture(); if (!dragging && !store.juliaPointer) store.commitAction(); }
function wheel(event: WheelEvent) {
  event.preventDefault(); const position = point(event);
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1);
  zoom(Math.exp(Math.max(-.6, Math.min(.6, delta * .0015))), position.x, position.y);
}
function key(event: KeyboardEvent) {
  if (store.locked || overview.value || props.keyboardBlocked || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, select, button, [role="dialog"], [role="slider"], [contenteditable="true"]')) return;
  const actions: Record<string, () => void> = { '+': () => zoom(.8), '=': () => zoom(.8), '-': () => zoom(1.25), ArrowLeft: () => pan(55, 0), ArrowRight: () => pan(-55, 0), ArrowUp: () => pan(0, 55), ArrowDown: () => pan(0, -55), Home: store.reset };
  if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
}
function lostContext(event: Event) { event.preventDefault(); error.value = ''; lost.value = true;hasImage.value=false; scheduler?.contextLost(); }
function restoredContext() { error.value = ''; lost.value = false; scheduler?.contextRestored(); }
function visibility() { scheduler?.visibility(document.hidden); }
function adoptOverview(){
  const state=scheduler?.getViewState();if(!state?.overview||store.locked)return;
  store.change({camera:state.camera},'adopt-overview');store.commitAction();
}
watch(scene, value => {
  const source=pendingJuliaKey===sceneMathKey(value)?'julia-pointer':'default';pendingJuliaKey=null;
  if(scheduler)scheduler.update(value,source==='julia-pointer',source);
}, { deep: true });
watch(() => props.lightGlass, value => { if (!value) scheduler?.resetGlassAdaptation(); });
watch(() => props.qualityProfile, value => scheduler?.setQualityProfile(value));
watch(()=>props.resourceMode,value=>scheduler?.setResourceMode(value??'standard'));
async function exportPng(fullHd: boolean, signal?: AbortSignal, progress?: (fraction: number) => void, iterations?: number) {
  if (!scheduler) throw new Error('Рендерер ещё не готов.');
  const size = renderSize(view, window.devicePixelRatio || 1);
  return scheduler.export(fullHd ? 1920 : size.width, fullHd ? 1080 : size.height, signal, progress, { iterations });
}
onMounted(() => {
  try {
    const runtime = createWebGLRuntime(canvas.value!, scene.value, {
      loading: value => { if (!disposed) loading.value = value; },
      error: value => { if (!disposed) { error.value = value; loading.value = false; } },
      stats: value => { if(value.viewing.ready)error.value='';progress.value = { phase: value.phase, fraction: value.progress,arithmetic:value.arithmetic };viewing.value=value.viewing;previewWarning.value=value.viewing.warning;if(value.computeWidth>0&&value.computeHeight>0)hasImage.value=true; emit('stats', value); }, lightGlass: () => emit('lightGlass'),
    });
    scheduler=runtime.session;diagnostics=runtime.diagnostics;
    scheduler.setResourceMode(props.resourceMode??'standard');scheduler.setQualityProfile(props.qualityProfile);
    observer = new ResizeObserver(([entry]) => { view = { width: entry.contentRect.width, height: entry.contentRect.height }; scheduler?.resize(view); });
    observer.observe(canvas.value!);
    canvas.value!.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility);
    visibility();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Ошибка WebGL2.'; loading.value = false; }
});
onBeforeUnmount(() => {
  disposed = true; observer?.disconnect(); scheduler?.dispose();
  canvas.value?.removeEventListener('wheel', wheel); window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility);
});
defineExpose({ zoom, pan, exportPng,exportViewing:(signal?:AbortSignal)=>{if(!scheduler)throw Error('Рендерер ещё не готов.');return scheduler.exportViewing(signal);}, getSession: () => scheduler, getDiagnostics: () => diagnostics, getViewport: () => ({ ...view }), getViewState:()=>scheduler?.getViewState(), adoptOverview });
</script>
<template>
  <canvas ref="canvas" class="fractal-canvas" data-testid="fractal-canvas" tabindex="0" aria-label="Фрактал. Перетаскивайте для перемещения, используйте колесо или клавиши плюс и минус для масштаба."
    @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="up" @contextmenu.prevent
    @webglcontextlost="lostContext" @webglcontextrestored="restoredContext" />
  <div v-if="loading || error || lost || !hasImage" class="canvas-message glass" role="status">
    <template v-if="error"><strong>Изображение недоступно</strong><p>{{ error }}</p></template>
    <template v-else-if="lost"><strong>Восстанавливаем изображение</strong><p>Браузер освободил графический контекст. Сцена сохранена.</p></template>
    <template v-else><v-progress-circular indeterminate :size="22" :width="2" /><span>Подготавливаем фрактал…</span></template>
  </div>
  <div v-if="hasImage && !loading && !error && !lost" class="precision-progress glass" role="status">Просмотр · {{ viewing?.arithmetic === 'double-single' ? 'DS' : 'float32' }} · {{ viewing?.effectiveIterations }} итераций<span v-if="viewing?.updatingJulia"> · Обновляем параметры Жюлиа; показан предыдущий кадр</span><span v-else-if="!viewing?.ready"> · Обновление изображения</span><span v-if="previewWarning"> · {{ previewWarning }}</span></div>
  <div v-if="overview" class="source-region" :style="regionStyle" data-testid="source-region" aria-hidden="true" />
  <div v-if="overview" class="overview-notice glass" role="status" data-testid="overview-notice"><strong>Показан обзор</strong><p>Исходный участок {{ viewing && viewing.requestedCamera.height/viewing.camera.height*view.height < 1 ? 'меньше пикселя и отмечен маркером' : 'отмечен рамкой' }}. Сохранение и точный PNG используют исходный кадр.</p><button type="button" data-testid="adopt-overview" :disabled="store.locked" @click="adoptOverview">Исследовать обзор</button></div>
</template>
