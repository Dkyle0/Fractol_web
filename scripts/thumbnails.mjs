import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__FRACTOL__);
  const images = await page.evaluate(async onlyNew => {
    const { FractalRenderer } = await import('/src/rendering/renderer.ts');
    const { fractals, createScene } = await import('/src/domain/catalog.ts');
    const canvas = document.createElement('canvas'), renderer = new FractalRenderer(canvas), output = [];
    try {
      for (const fractal of fractals.filter(f => !onlyNew || ['newton', 'nova', 'phoenix', 'magnet-1'].includes(f.id))) {
        const scene = createScene(fractal.id);
        if (!['newton', 'nova', 'phoenix', 'magnet-1'].includes(fractal.id)) scene.camera.height = Math.min(3.4, scene.camera.height);
        scene.coloring.palette = fractal.id === 'newton' ? 'spectrum' : ['burning-ship', 'legacy-ship'].includes(fractal.id) ? 'ember' : fractal.id === 'julia' || fractal.id === 'multibrot' ? 'nebula' : 'aurora';
        const blob = await renderer.export(scene, 320, 210);
        const bitmap = await createImageBitmap(blob), target = document.createElement('canvas'); target.width = 320; target.height = 210;
        target.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
        output.push({ id: fractal.id, data: target.toDataURL('image/webp', .87).split(',')[1] });
      }
    } finally { renderer.dispose(); }
    return output;
  }, process.argv.includes('--new'));
  await mkdir('public/thumbnails', { recursive: true });
  for (const image of images) await writeFile(`public/thumbnails/${image.id}.webp`, Buffer.from(image.data, 'base64'));
  console.log(`Generated ${images.length} GPU-rendered thumbnails.`);
} finally { await browser.close(); }
