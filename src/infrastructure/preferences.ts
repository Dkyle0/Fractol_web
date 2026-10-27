import { isQualityProfile, type QualityProfile } from '../domain/quality';
import { isResourcePreference, type ResourcePreference } from '../domain/resources';
export interface Preferences { version: 1; lightGlass: boolean; diagnostics: boolean; qualityProfile: QualityProfile; resourceMode?: ResourcePreference }
export const PREFERENCES_KEY = 'fractol.preferences.v1';
export function readPreferences(): { preferences: Preferences; warning: string } {
  const defaults: Preferences = { version: 1, lightGlass: false, diagnostics: false, qualityProfile: 'auto' };
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || 'null');
    if (value?.version === 1 && typeof value.lightGlass === 'boolean' && typeof value.diagnostics === 'boolean') return {
      preferences: { version: 1, lightGlass: value.lightGlass, diagnostics: value.diagnostics, qualityProfile: isQualityProfile(value.qualityProfile) ? value.qualityProfile : 'auto', ...(value.resourceMode !== undefined ? {resourceMode:isResourcePreference(value.resourceMode)?value.resourceMode:'auto' as const}: {}) },
      warning: value.qualityProfile !== undefined && !isQualityProfile(value.qualityProfile) ? 'Профиль качества не распознан. Использован «Авто».' : '',
    };
    return { preferences: defaults, warning: value == null ? '' : 'Настройки оформления не распознаны. Использованы стандартные.' };
  } catch { return { preferences: defaults, warning: 'Не удалось прочитать настройки оформления.' }; }
}
export function writePreferences(value: Preferences) {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value)); return true; } catch { return false; }
}
