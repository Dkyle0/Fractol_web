import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { createScene, getFractal } from '../domain/catalog';
import { applyPreset, decodeScene, resetCamera } from '../domain/scene';
import { copyScene, type FractalId, type SceneState } from '../domain/types';
import { readLibrary, writeLibrary } from '../infrastructure/storage';
import { SceneHistory } from '../domain/history';
import { mergeLibrary, previewLibraryImport } from '../domain/library';

export const useExplorer = defineStore('explorer', () => {
  const restored = readLibrary();
  const scene = ref<SceneState>(decodeScene(location.hash) ?? createScene());
  const library = ref(restored.library);
  const notification = ref(restored.warning || (location.hash && !decodeScene(location.hash) ? 'Ссылка не распознана. Открыта стартовая сцена.' : ''));
  const notificationPersistent=ref(!!notification.value);
  const juliaPointer = ref(false);
  const locked = ref(false), canUndo = ref(false), canRedo = ref(false);
  const history = new SceneHistory();
  let action = '', timer: ReturnType<typeof setTimeout> | undefined;
  function syncHistory() { canUndo.value = history.canUndo; canRedo.value = history.canRedo; }
  function commitAction() { clearTimeout(timer); history.commit(scene.value); action = ''; syncHistory(); }
  function beginAction(key: string) {
    if (locked.value) return;
    if (action !== key) { commitAction(); juliaPointer.value = false; history.begin(scene.value); action = key; }
    clearTimeout(timer); syncHistory();
  }
  function change(patch: Partial<Omit<SceneState, 'camera' | 'parameters' | 'coloring'>> & { camera?: Partial<SceneState['camera']>; parameters?: Partial<SceneState['parameters']>; coloring?: Partial<SceneState['coloring']> }, key = 'change', settle = false) {
    if (locked.value) return;
    beginAction(key);
    scene.value = { ...scene.value, ...patch, camera: { ...scene.value.camera, ...patch.camera }, parameters: { ...scene.value.parameters, ...patch.parameters }, coloring: { ...scene.value.coloring, ...patch.coloring } };
    syncHistory(); if (settle) timer = setTimeout(commitAction, 300);
  }
  function undo() { if (locked.value) return; clearTimeout(timer); scene.value = history.undo(scene.value); action = ''; juliaPointer.value = false; syncHistory(); }
  function redo() { if (locked.value) return; clearTimeout(timer); scene.value = history.redo(scene.value); action = ''; juliaPointer.value = false; syncHistory(); }
  function setJuliaPointer(enabled: boolean) {
    if (locked.value) return;
    if (enabled) { beginAction('julia-pointer'); juliaPointer.value = true; }
    else { commitAction(); juliaPointer.value = false; }
  }
  // Used only by the benchmark; preserves history and user action boundaries.
  function transient(next: SceneState) { scene.value = copyScene(next); }
  const definition = computed(() => getFractal(scene.value.fractalId));
  function notify(message: string,persistent=false) { notification.value = message;notificationPersistent.value=persistent; }
  function dismissNotification(){notification.value='';notificationPersistent.value=false;}
  function update(next: SceneState) { if (locked.value) return; beginAction('replace'); scene.value = copyScene(next); commitAction(); }
  function select(id: FractalId) {
    const next = createScene(id);
    next.coloring = { ...scene.value.coloring };
    update(next); juliaPointer.value = false;
  }
  function preset(index: number) { update(applyPreset(scene.value, index)); }
  function reset() { update(resetCamera(scene.value)); }
  function favorite(id: FractalId) {
    const index = library.value.favorites.indexOf(id);
    if (index < 0) library.value.favorites.push(id); else library.value.favorites.splice(index, 1);
  }
  function save(name: string) {
    if (!name.trim()) return;
    if (library.value.scenes.length >= 100) { notify('В коллекции уже 100 сцен. Удалите ненужные, чтобы добавить новую.'); return; }
    library.value.scenes.unshift({ id: crypto.randomUUID(), name: name.trim().slice(0, 80), createdAt: new Date().toISOString(), scene: copyScene(scene.value) });
  }
  function load(id: string) { const item = library.value.scenes.find(s => s.id === id); if (item) { update(item.scene); juliaPointer.value = false; } }
  function remove(id: string) { library.value.scenes = library.value.scenes.filter(s => s.id !== id); }
  function rename(id: string, name: string) { const item = library.value.scenes.find(s => s.id === id); if (item && name.trim()) item.name = name.trim().slice(0, 80); }
  function importLibrary(raw: string) { library.value = mergeLibrary(library.value, previewLibraryImport(raw, library.value)); }
  watch(library, value => { if (!writeLibrary(value)) notify('Браузер не сохранил коллекцию. Скопируйте ссылку на сцену.'); }, { deep: true, flush: 'post' });
  return { scene, library, definition, notification,notificationPersistent,dismissNotification, juliaPointer, locked, canUndo, canRedo, beginAction, commitAction, change, undo, redo, setJuliaPointer, transient, notify, update, select, preset, reset, favorite, save, load, remove, rename, importLibrary };
});
