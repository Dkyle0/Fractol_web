import { test,expect } from '@playwright/test';
test('обычный предел детализации ограничен 2000, ошибочный ввод не меняет сцену',async({page})=>{
 await page.goto('/?debug=1');await page.waitForFunction(()=>window.__FRACTOL__);
 const slider=page.getByRole('slider',{name:'Число итераций',exact:true});
 const input=page.getByRole('spinbutton',{name:'Предел итераций',exact:true});
 await expect(slider).toHaveAttribute('aria-valuemax','2000');await expect(input).toHaveAttribute('max','2000');
 await slider.focus();await slider.press('End');await expect(input).toHaveValue('2000');
 expect(await page.evaluate(()=>window.__FRACTOL__!.scene().iterations)).toBe(2000);
 for(const rejected of ['2001','16384']){
  await input.fill(rejected);await expect(input).toHaveAttribute('aria-invalid','true');await input.press('Enter');
  await expect(input).toHaveValue('2000');expect(await page.evaluate(()=>window.__FRACTOL__!.scene().iterations)).toBe(2000);
  await input.fill(rejected);await input.blur();await expect(input).toHaveValue('2000');
  expect(await page.evaluate(()=>window.__FRACTOL__!.scene().iterations)).toBe(2000);
 }
 await input.fill('1999');await input.press('Enter');
 await expect(input).toHaveValue('1999');expect(await page.evaluate(()=>window.__FRACTOL__!.scene().iterations)).toBe(1999);
});
test('сцена с 16384 сохраняется до явного применения 2000, действие отменяется',async({page})=>{
 await page.goto('/?debug=1');await page.waitForFunction(()=>window.__FRACTOL__);
 const source=await page.evaluate(async()=>{
  const scene=window.__FRACTOL__!.scene();scene.camera={x:3,y:3,height:.1};scene.iterations=16384;
  location.hash='#scene='+encodeURIComponent(JSON.stringify(scene));
  await new Promise<void>(resolve=>addEventListener('hashchange',()=>resolve(),{once:true}));
  return window.__FRACTOL__!.scene();
 });
 expect(source.iterations).toBe(16384);
 await expect(page.getByRole('spinbutton',{name:'Предел итераций',exact:true})).toHaveCount(0);
 await expect(page.getByText(/В этой сцене сохранено 16384 итераций/)).toBeVisible();
 await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
 await page.getByRole('button',{name:'Установить 2000'}).click();
 expect(await page.evaluate(()=>window.__FRACTOL__!.scene().iterations)).toBe(2000);
 await page.keyboard.press('Control+z');
 expect(await page.evaluate(()=>window.__FRACTOL__!.scene().iterations)).toBe(16384);
});
test('16384 executes past 2000 and multi-pixel slices retain binary64 orbital state',async({page})=>{
 test.setTimeout(120000);await page.goto('/src/rendering/binary64.ts');
 const result=await page.evaluate(async()=>{
  const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',ep='/src/domain/reference.ts';
  const {FractalRenderer}=await import(rp),{createScene}=await import(cp),{evaluatePoint}=await import(ep);
  const r=new FractalRenderer(document.createElement('canvas')),failures:string[]=[];
  try{
   const scene=createScene();scene.camera={x:-.743643887037151,y:.13182590420533,height:1};r.resize(1,1);
   const values=[];for(const limit of [2000,16384]){scene.iterations=limit;await r.refine(scene);const cpu=evaluatePoint('mandelbrot',scene.camera.x,scene.camera.y,limit,scene.parameters),gpu=r.readPoint(0,0);values.push(gpu);if(cpu.status!==gpu.status||Math.abs(cpu.value-gpu.value)>2/256)failures.push(JSON.stringify({cpu,gpu}));}
   scene.iterations=128;scene.camera={x:-.65,y:0,height:3.8};r.resize(145,137);await r.refine(scene);
   for(const [x,y] of [[0,0],[127,127],[128,127],[127,128],[128,128],[144,136],[72,68]]){
    const px=scene.camera.x+(x+.5-145/2)*scene.camera.height/137,py=scene.camera.y+(y+.5-137/2)*scene.camera.height/137;
    const cpu=evaluatePoint('mandelbrot',px,py,128,scene.parameters),gpu=r.readPoint(x,y);if(cpu.status!==gpu.status||Math.abs(cpu.value-gpu.value)>2/256)failures.push(JSON.stringify({x,y,cpu,gpu}));
   }
   return {values,failures,memory:r.getMemoryEstimate()};
  }finally{r.dispose();}
 });
 expect(result.failures).toEqual([]);expect(result.values[0]!.status).toBe('unresolved');expect(result.values[1]!.status).toBe('escaped');expect(result.values[1]!.value).toBeGreaterThan(2000);expect(result.memory.scratchBytes).toBe(0);
});
