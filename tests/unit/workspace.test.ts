import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { createScene } from '../../src/domain/catalog';
import { SceneHistory } from '../../src/domain/history';
import { previewLibraryImport, mergeLibrary } from '../../src/domain/library';
import { useExplorer } from '../../src/stores/explorer';
import { readPreferences, writePreferences } from '../../src/infrastructure/preferences';
import type { Library, SavedScene } from '../../src/domain/types';
const saved = (id = 'a', name = 'Моя сцена'): SavedScene => ({ id, name, createdAt: '2026-10-18T12:00:00.000Z', scene: createScene() });
const library = (scenes: SavedScene[] = []): Library => ({ version: 1, favorites: [], scenes });

describe('history and collection', () => {
  it('groups changes, copies scenes, branches after undo and bounds history', () => {
    const history = new SceneHistory(2), scene = createScene();
    history.begin(scene); scene.camera.x = 1; history.begin(scene); scene.camera.x = 2; history.commit(scene);
    expect(history.undo(scene).camera.x).toBe(-.65);
    expect(history.redo(createScene()).camera.x).toBe(2);
    for (const x of [3, 4, 5]) { history.begin(scene); scene.camera.x = x; history.commit(scene); }
    let previous = history.undo(scene); expect(previous.camera.x).toBe(4);
    previous = history.undo(previous); expect(previous.camera.x).toBe(3);
    expect(history.canUndo).toBe(false);
    history.begin(previous); previous.camera.x = 8; history.commit(previous); expect(history.canRedo).toBe(false);
  });
  it('does not record unchanged actions', () => { const h = new SceneHistory(), s = createScene(); h.begin(s); h.commit(s); expect(h.canUndo).toBe(false); });
  it('previews malformed records, deduplicates content, resolves id collisions and re-imports idempotently', () => {
    const current = library([saved()]);
    const raw = JSON.stringify({ version: 1, favorites: ['julia', 'unknown'], scenes: [saved(), saved('a', 'Другая'), null] });
    const preview = previewLibraryImport(raw, current);
    expect(preview).toMatchObject({ duplicates: 1, invalid: 2, overflow: false });
    expect(preview.additions).toHaveLength(1); expect(preview.additions[0]!.id).not.toBe('a');
    const merged = mergeLibrary(current, preview);
    expect(merged.favorites).toEqual(['julia']); expect(current.scenes).toHaveLength(1);
    expect(previewLibraryImport(raw, merged).additions).toHaveLength(0);
  });
  it('rejects oversized, unsupported and broken files before applying', () => {
    for (const raw of ['{', '{"version":2,"scenes":[],"favorites":[]}', ' '.repeat(1024 * 1024 + 1)]) expect(() => previewLibraryImport(raw, library())).toThrow();
  });
  it('rejects a whole overflowing merge', () => {
    const current = library(Array.from({ length: 100 }, (_, i) => saved(String(i), String(i))));
    const preview = previewLibraryImport(JSON.stringify(library([saved('new')])), current);
    expect(preview.overflow).toBe(true); expect(() => mergeLibrary(current, preview)).toThrow(); expect(current.scenes).toHaveLength(100);
  });
});
describe('scene commands and preferences', () => {
  beforeEach(() => {
    vi.useFakeTimers(); setActivePinia(createPinia());
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    vi.stubGlobal('location', { hash: '' });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('groups navigation until 300ms and supports a new branch', () => {
    const s = useExplorer(); s.change({ camera: { x: 1 } }, 'camera-navigation', true); vi.advanceTimersByTime(200); s.change({ camera: { x: 2 } }, 'camera-navigation', true); vi.advanceTimersByTime(300);
    s.undo(); expect(s.scene.camera.x).toBe(-.65); s.redo(); expect(s.scene.camera.x).toBe(2);
    s.undo(); s.select('julia'); expect(s.canRedo).toBe(false); s.undo(); expect(s.scene.fractalId).toBe('mandelbrot');
  });
  it('groups gestures and Julia pointer mode and excludes transient benchmark frames', () => {
    const s = useExplorer(); s.select('julia'); const initial = s.scene.parameters.juliaRe;
    s.setJuliaPointer(true); s.change({ parameters: { juliaRe: .1 } }, 'julia-pointer'); s.change({ parameters: { juliaRe: .2 } }, 'julia-pointer'); s.setJuliaPointer(false);
    s.undo(); expect(s.scene.parameters.juliaRe).toBe(initial);
    const snapshot = structuredClone(JSON.parse(JSON.stringify(s.scene))); s.locked = true; s.select('buffalo'); s.change({ camera: { x: 8 } }); expect(s.scene.fractalId).toBe('julia');
    s.transient(createScene('burning-ship')); s.transient(snapshot); s.locked = false; s.redo(); expect(s.scene.parameters.juliaRe).toBe(.2);
  });
  it('starts at Mandelbrot regardless of the last session and honors links', () => {
    const s = useExplorer(); s.select('julia'); setActivePinia(createPinia()); expect(useExplorer().scene.fractalId).toBe('mandelbrot');
    location.hash = '#scene=' + encodeURIComponent(JSON.stringify(createScene('buffalo'))); setActivePinia(createPinia()); expect(useExplorer().scene.fractalId).toBe('buffalo');
  });
  it('persists manual preferences separately and handles storage refusal', async () => {
    expect(readPreferences().preferences.lightGlass).toBe(false);
    expect(writePreferences({ version: 1, lightGlass: true, diagnostics: true, qualityProfile: "auto" })).toBe(true); expect(readPreferences().preferences.lightGlass).toBe(true);
    vi.stubGlobal('localStorage', { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } });
    expect(readPreferences().warning).not.toBe(''); expect(writePreferences({ version: 1, lightGlass: false, diagnostics: false, qualityProfile: "auto" })).toBe(false);
    const s = useExplorer(); s.save('Сохранение'); await nextTick(); expect(s.library.scenes).toHaveLength(1); expect(s.notification).toContain('не сохранил');
  });
});
