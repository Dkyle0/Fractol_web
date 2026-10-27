import { parseScene } from './scene';
import { fractals } from './catalog';
import type { Library, SavedScene } from './types';

export const MAX_IMPORT_BYTES = 1024 * 1024;
export interface LibraryImportPreview { additions: SavedScene[]; favorites: Library['favorites']; duplicates: number; invalid: number; overflow: boolean }
const fingerprint = (s: SavedScene) => JSON.stringify([s.name.trim(), s.createdAt, parseScene(s.scene)]);
export function previewLibraryImport(raw: string, current: Library): LibraryImportPreview {
  if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES) throw new Error('Файл больше 1 МиБ.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Не удалось прочитать JSON коллекции.'); }
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('scenes' in value) || !Array.isArray(value.scenes) || !('favorites' in value) || !Array.isArray(value.favorites)) throw new Error('Формат коллекции не поддерживается.');
  const preview: LibraryImportPreview = { additions: [], favorites: [], duplicates: 0, invalid: 0, overflow: false };
  const seen = new Set(current.scenes.map(fingerprint)), ids = new Set(current.scenes.map(s => s.id));
  for (const item of value.scenes) {
    const scene = item && typeof item === 'object' ? parseScene(item.scene) : null;
    if (!scene || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 100 || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 80 || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) { preview.invalid++; continue; }
    const candidate: SavedScene = { id: item.id, name: item.name.trim(), createdAt: item.createdAt, scene };
    const key = fingerprint(candidate);
    if (seen.has(key)) { preview.duplicates++; continue; }
    if (ids.has(candidate.id)) candidate.id = crypto.randomUUID();
    ids.add(candidate.id); seen.add(key); preview.additions.push(candidate);
  }
  for (const id of value.favorites) {
    if (fractals.some(f => f.id === id)) { if (!preview.favorites.includes(id)) preview.favorites.push(id); }
    else preview.invalid++;
  }
  preview.overflow = current.scenes.length + preview.additions.length > 100;
  return preview;
}
export function mergeLibrary(current: Library, preview: LibraryImportPreview): Library {
  if (preview.overflow || current.scenes.length + preview.additions.length > 100) throw new Error('После импорта будет больше 100 сцен. Освободите место в коллекции.');
  return { version: 1, favorites: [...new Set([...current.favorites, ...preview.favorites])], scenes: [...preview.additions, ...current.scenes] };
}
