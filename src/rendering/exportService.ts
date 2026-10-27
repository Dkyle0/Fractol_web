import { copyScene } from '../domain/types';
import type { ExportRequest, RenderBackend } from './backend';
export class ExportService {
  private cpuBufferBytes=0;
  constructor(private backend: RenderBackend) {}
  getMemoryEstimate() { return { exportCpuBufferBytes:this.cpuBufferBytes }; }
  async run(request: ExportRequest, signal?: AbortSignal, progress?: (fraction: number) => void) {
    if (request.arithmetic !== 'binary64') throw new Error('Запрошенная точность экспорта пока не поддерживается.');
    signal?.throwIfAborted();
    if (!Number.isInteger(request.scene.iterations) || request.scene.iterations < 64 || request.scene.iterations > 16384) throw new Error('Итерации экспорта: целое число от 64 до 16384.');
    const {width,height}=request,maxTextureSize=this.backend.getCapabilities().maxTextureSize;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>this.backend.limits.maxPixels||width>maxTextureSize||height>maxTextureSize)throw new Error('Этот размер изображения недоступен на устройстве.');
    // Reserved peak for readback + row-flipped copy; excludes browser canvas/driver memory.
    this.cpuBufferBytes=width*height*8;
    try { return await this.backend.exportFrame({ ...request, scene: copyScene(request.scene) }, signal, progress); }
    finally { this.cpuBufferBytes=0; }
  }
}
