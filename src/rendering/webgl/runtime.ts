import { RenderSession } from '../session';
import { WebGLBackend } from '../renderer';
import type { SceneState } from '../../domain/types';

/** Explicit test surface. This object is not the application's rendering API. */
export class WebGLDiagnostics {
  constructor(private backend: WebGLBackend,private session?:RenderSession) {}
  setNavigationFeatures(continuousJulia:boolean,cache:boolean) { this.session?.setNavigationFeaturesForDiagnostics(continuousJulia,cache); }
  subscribeRenderEvents(...args:Parameters<WebGLBackend['subscribeRenderEvents']>){return this.backend.subscribeRenderEvents(...args);}
  getRenderCounters(){return this.backend.getRenderCounters();}
  getContext() { return this.backend.getContext(); }
  get stats() { return this.backend.getSnapshot(); }
  getMemoryEstimate() { return this.backend.getMemoryEstimate(); }
  setPrecisionBudget(target:3|6) { this.backend.setPrecisionBudget(target); }
  subscribeMeasurements(...args:Parameters<WebGLBackend['subscribeMeasurements']>) { return this.backend.subscribeMeasurements(...args); }
  readPoint(x: number, y: number) { return this.backend.readPoint(x,y); }
  get resize() { return this.backend.resize.bind(this.backend); }
  set resize(value: WebGLBackend['resize']) { this.backend.resize=value; }
  get prepare() { return this.backend.prepare.bind(this.backend); }
  set prepare(value: WebGLBackend['prepare']) { this.backend.prepare=value; }
  get delay() { return this.backend.compilationDelay; }
  set delay(value: () => Promise<void>) { this.backend.compilationDelay=value; }
}
export function createWebGLRuntime(canvas: HTMLCanvasElement, scene: SceneState, callbacks: ConstructorParameters<typeof RenderSession>[2]) {
  const backend=new WebGLBackend(canvas);
  const session=new RenderSession(backend,scene,callbacks);
  return { session, diagnostics:new WebGLDiagnostics(backend,session) };
}
