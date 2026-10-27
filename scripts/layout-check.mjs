import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('layout-check');
import { chromium } from '@playwright/test';
import { mkdir, writeFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
const output=process.env.LAYOUT_OUTPUT||'navigation';
if(!/^[a-z0-9._-]+$/i.test(output))throw Error('Invalid LAYOUT_OUTPUT');
try{await access(`${artifactsRoot}/${output}-visual.json`);throw Error('Output exists; choose a new LAYOUT_OUTPUT');}catch(error){if(error.code!=='ENOENT')throw error;}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [],consoleErrors=[]; page.on('pageerror', e => errors.push(e.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await mkdir(artifactsRoot, { recursive: true });
  for (const width of [1440, 900, 390, 320]) for (const light of [false, true]) {
    await page.setViewportSize({ width, height: width >= 900 ? 900 : 844 });
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForFunction(() => window.__FRACTOL__?.stats()?.draws > 0);
    await page.evaluate(light => window.__FRACTOL__.glass(!light), light);
    const shot = async state => {
      await page.waitForFunction(()=>!document.querySelector('.panel-left-enter-active,.panel-left-leave-active,.panel-right-enter-active,.panel-right-leave-active'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const path=`${artifactsRoot}/${output}-${width}-${light ? 'light' : 'glass'}-${state}.png`;
      try{await access(path);throw Error('Screenshot output exists: '+path);}catch(error){if(error.code!=='ENOENT')throw error;}
      await page.screenshot({ path, animations: 'disabled' });
    };
    await shot('normal');
    for (const label of ['Закрыть каталог', 'Скрыть параметры']) {
      const button = page.getByRole('button', { name: label, exact: true });
      if (await button.isVisible()) {await button.click();await button.waitFor({state:'hidden'});}
    }
    await shot('closed');
    await page.getByRole('button', { name: 'Скрыть интерфейс', exact: true }).click();
    await page.locator('.topbar').waitFor({state:'hidden'});
    await shot('minimal');
    await page.getByRole('button', { name: 'Параметры', exact: true }).click();
    await page.getByTestId('controls-panel').waitFor({state:'visible'});
    await shot('parameters');
  }
  assert.deepEqual(errors, []);assert.deepEqual(consoleErrors,[]);
  await writeFile(`${artifactsRoot}/${output}-visual.json`, JSON.stringify({ widths: [1440, 900, 390, 320], glass: ['full', 'light'], states: ['normal', 'closed', 'minimal', 'parameters'], errors,consoleErrors }, null, 2),{flag:'wx'});
  console.log('32 navigation screenshots; full/light glass; no page overflow, runtime errors, or console errors.');
} finally { await browser.close(); }
