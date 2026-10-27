export type FractalId = 'mandelbrot' | 'julia' | 'burning-ship' | 'tricorn' | 'multibrot' | 'celtic' | 'buffalo' | 'perpendicular' | 'legacy-ship' | 'legacy-something' | 'newton' | 'nova' | 'phoenix' | 'magnet-1';
export interface Camera { x: number; y: number; height: number }
export interface Parameters { juliaRe: number; juliaIm: number; power: number; novaRelaxation?: number; phoenixRe?: number; phoenixIm?: number; phoenixMemory?: number }
export type ResultKind = 'escape' | 'legacy-escape' | 'basins' | 'convergence' | 'hybrid';
export type OrbitStatus = 'unresolved' | 'escaped' | 'converged' | 'singular' | 'numerical-error';
export interface OrbitResult { status: OrbitStatus; root: number | null; value: number }
export interface ParameterDefinition { key: keyof Parameters; type: 'integer' | 'real'; label: string; min: number; max: number; step: number; default: number }
export interface Coloring { palette: string; phase: number; density: number; interior: string }
export interface SceneState {
  schemaVersion: 1;
  fractalId: FractalId;
  formulaVersion: 1;
  camera: Camera;
  parameters: Parameters;
  iterations: number;
  coloring: Coloring;
}
export interface Preset { name: string; camera: Camera; parameters?: Partial<Parameters> }
export interface FractalDefinition {
  id: FractalId;
  version: 1;
  shaderKind: number;
  resultKind: ResultKind;
  name: string;
  subtitle: string;
  description: string;
  formula: string;
  category: 'Классика' | 'Вариации' | 'Наследие';
  parameters: ParameterDefinition[];
  presets: [Preset, Preset, ...Preset[]];
}
export interface SavedScene { id: string; name: string; createdAt: string; scene: SceneState }
export interface Library { version: 1; favorites: FractalId[]; scenes: SavedScene[] }
export const copyScene = (scene: SceneState): SceneState => ({ ...scene, camera: { ...scene.camera }, parameters: { ...scene.parameters }, coloring: { ...scene.coloring } });
