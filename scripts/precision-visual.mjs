import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('precision-visual');
import { chromium } from '@playwright/test';
import { mkdir,writeFile,access } from 'node:fs/promises';
const name=process.env.VISUAL_OUTPUT||'v1.4';
if(!/^[a-z0-9._-]+$/i.test(name))throw new Error('VISUAL_OUTPUT must be a filename without directories');
const output=`${artifactsRoot}/${name}`;
await mkdir(output,{recursive:true});
try{await access(`${output}/visual.json`);throw new Error('Visual artifacts already exist; preserve them before rerunning');}catch(error){if(error.code!=='ENOENT')throw error;}
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const width of [320,390,900,1440]){
    await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:5173/?debug=1');
    await page.waitForFunction(()=>window.__FRACTOL__?.stats()?.draws>0);
    if(width<1280)await page.getByRole('button',{name:'Параметры',exact:true}).click();
    for(const light of [false,true]){
      await page.evaluate(light=>window.__FRACTOL__.glass(!light),light);
      await page.waitForTimeout(250);
      const overflow=await page.locator('body').evaluate(body=>body.scrollWidth>innerWidth);
      const filename=`${output}/precision-${width}-${light?'light':'glass'}.png`;
      await page.screenshot({path:filename});checks.push({width,light,overflow,filename});
    }
    await page.evaluate(()=>{
      const api=window.__FRACTOL__;api.select('nova');const scene=api.scene();
      scene.camera={x:-.4886187166588625,y:.07824630200526818,height:.00019541448104899833};scene.iterations=16384;api.setScene(scene);
    });
    await page.getByRole('button',{name:'Экспорт PNG',exact:true}).click();
    await page.getByRole('button',{name:/Full HD/}).click();
    await page.getByRole('button',{name:'Скачать PNG',exact:true}).click();
    await page.getByRole('button',{name:'Отменить экспорт',exact:true}).waitFor();
    const filename=`${output}/export-progress-${width}.png`;await page.screenshot({path:filename});checks.push({width,filename});
    await page.getByRole('button',{name:'Отменить экспорт',exact:true}).click();
  }
  await writeFile(`${output}/visual.json`,JSON.stringify({recordedAt:new Date().toISOString(),browser:browser.version(),checks,errors},null,2),{flag:'wx'});
  if(errors.length||checks.some(check=>check.overflow))throw new Error('Visual checks found overflow or runtime errors');
  console.log(`Saved ${checks.length} visual states, no horizontal overflow or runtime errors.`);
}finally{await browser.close();}
