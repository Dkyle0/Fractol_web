import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('quality-visual');
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(); const errors = [], shots = [];
  page.on('pageerror', e => errors.push(e.message));
  await mkdir(artifactsRoot, { recursive: true });
  for (const width of [320, 390, 900, 1440]) for (const light of [false, true]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto('http://127.0.0.1:5173/?debug=1');
    await page.waitForFunction(() => window.__FRACTOL__?.stats()?.draws > 0);
    await page.getByRole('button', { name: 'Оформление', exact: true }).click();
    const glass = page.getByRole('button', { name: 'Лёгкое стекло', exact: true });
    if ((await glass.getAttribute('aria-pressed')) !== String(light)) await glass.click();
    for (const [profile, name] of [['auto', 'Авто'], ['performance', 'Плавность'], ['quality', 'Качество']]) {
      const radio = page.getByRole('group', { name: 'Профиль качества', exact: true }).getByRole('radio', { name: new RegExp(`^${name}`) }); await radio.check(); await expect(radio).toBeChecked();
      await page.locator('.dialog-card').evaluate(el => { el.scrollTop = 0; });
      const path = `${artifactsRoot}/quality-${width}-${light ? 'light' : 'glass'}-${profile}.png`;
      await page.screenshot({ path, animations: 'disabled' }); shots.push(path);
      const overflow = await page.locator('.dialog-card').evaluate(el => el.scrollWidth > el.clientWidth);
      if (overflow || await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(`Overflow at ${width}`);
    }
    await page.getByRole('button', { name: 'Бенчмарк', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${artifactsRoot}/quality-${width}-${light ? 'light' : 'glass'}-bottom.png`, animations: 'disabled' });
  }
  if (errors.length) throw Error(errors.join('\n'));
  await writeFile(`${artifactsRoot}/quality-visual.json`, JSON.stringify({ recordedAt: new Date().toISOString(), widths: [320, 390, 900, 1440], shots, bottomShots: 8, errors }, null, 2));
  console.log('32 quality settings screenshots; no runtime errors or horizontal overflow.');
} finally { await browser.close(); }
