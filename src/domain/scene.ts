import { createScene, fractals, getFractal } from './catalog';
import { palettes } from './palettes';
import { copyScene, type FractalId, type Library, type SceneState } from './types';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function parseScene(value: unknown): SceneState | null {
  if (!record(value) || value.schemaVersion !== 1 || value.formulaVersion !== 1 || !fractals.some(f => f.id === value.fractalId)) return null;
  const { camera, parameters, coloring } = value;
  if (!record(camera) || !number(camera.x, -20, 20) || !number(camera.y, -20, 20) || !number(camera.height, 1e-15, 12)) return null;
  if (!record(parameters) || !number(parameters.juliaRe, -2, 2) || !number(parameters.juliaIm, -2, 2) || !number(parameters.power, 2, 8) || !Number.isInteger(parameters.power)) return null;
  const normalized = { juliaRe: parameters.juliaRe, juliaIm: parameters.juliaIm, power: parameters.power };
  for (const field of getFractal(value.fractalId as FractalId).parameters) {
    const input = parameters[field.key] === undefined ? field.default : parameters[field.key];
    if (!number(input, field.min, field.max) || (field.type === 'integer' && !Number.isInteger(input))) return null;
    Object.assign(normalized, { [field.key]: input });
  }
  if (!number(value.iterations, 64, 16384) || !Number.isInteger(value.iterations)) return null;
  if (!record(coloring) || !palettes.some(p => p.id === coloring.palette) || !number(coloring.phase, 0, 1) || !number(coloring.density, 0.25, 3) || typeof coloring.interior !== 'string' || !/^#[\da-fA-F]{6}$/.test(coloring.interior)) return null;
  return {
    schemaVersion: 1, fractalId: value.fractalId as FractalId, formulaVersion: 1,
    camera: { x: camera.x, y: camera.y, height: camera.height },
    parameters: normalized,
    iterations: value.iterations,
    coloring: { palette: coloring.palette as string, phase: coloring.phase, density: coloring.density, interior: coloring.interior },
  };
}
export function encodeScene(scene: SceneState) { return '#scene=' + encodeURIComponent(JSON.stringify(copyScene(scene))); }
export function decodeScene(hash: string): SceneState | null {
  if (!hash.startsWith('#scene=') || hash.length > 16_384) return null;
  try { return parseScene(JSON.parse(decodeURIComponent(hash.slice(7)))); } catch { return null; }
}
export function parseLibrary(value: unknown): Library {
  const empty: Library = { version: 1, favorites: [], scenes: [] };
  if (!record(value) || value.version !== 1) return empty;
  if (Array.isArray(value.favorites)) empty.favorites = [...new Set(value.favorites.filter((id): id is FractalId => fractals.some(f => f.id === id)))];
  if (Array.isArray(value.scenes)) for (const item of value.scenes.slice(0, 100)) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || empty.scenes.some(s => s.id === item.id) || typeof item.name !== 'string' || !item.name.trim() || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) continue;
    const scene = parseScene(item.scene);
    if (scene) empty.scenes.push({ id: item.id.slice(0, 100), name: item.name.trim().slice(0, 80), createdAt: item.createdAt, scene });
  }
  return empty;
}
export function applyPreset(scene: SceneState, index: number): SceneState {
  const next = createScene(scene.fractalId, index);
  next.coloring = { ...scene.coloring };
  next.iterations = scene.iterations;
  return next;
}
export const resetCamera = (scene: SceneState): SceneState => ({ ...copyScene(scene), camera: { ...getFractal(scene.fractalId).presets[0].camera } });
