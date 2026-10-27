import { parseLibrary } from '../domain/scene';
import type { Library } from '../domain/types';
export const LIBRARY_KEY = 'fractol.library.v1';
export function readLibrary(): { library: Library; warning: string } {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    return { library: parseLibrary(raw ? JSON.parse(raw) : null), warning: '' };
  } catch { return { library: parseLibrary(null), warning: 'Не удалось прочитать сохранения. Текущая сцена продолжит работать.' }; }
}
export function writeLibrary(library: Library): boolean {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)); return true; } catch { return false; }
}
