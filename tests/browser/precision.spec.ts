import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function watchPrecisionPasses(page:import('@playwright/test').Page){
  await page.evaluate(()=>{
    const probe={passes:0};(window as unknown as {pngRefinementProbe:typeof probe}).pngRefinementProbe=probe;
    const prototype=WebGL2RenderingContext.prototype,original=prototype.drawArrays,programs=new WeakMap<WebGLProgram,boolean>();
    prototype.drawArrays=function(...args:Parameters<typeof original>){
      const program=this.getParameter(this.CURRENT_PROGRAM) as WebGLProgram|null;
      if(program){
        if(!programs.has(program))programs.set(program,(this.getAttachedShaders(program)??[]).some(shader=>(this.getShaderSource(shader)??'').includes('uvec2 r[')));
        if(programs.get(program))probe.passes++;
      }
      return original.apply(this,args);
    };
  });
}

test('software binary64 arithmetic matches independent JS binary64 bits across the exponent range', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/src/rendering/binary64.ts');
  const result = await page.evaluate(async () => {
    const path = '/src/rendering/renderer.ts', probePath = '/src/rendering/binary64Probe.ts';
    const { FractalRenderer } = await import(path), { selfTestPairs } = await import(probePath);
    const renderer = new FractalRenderer(document.createElement('canvas'));
    let seed = 0x41af32;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    const number = () => { const b = new ArrayBuffer(8), v = new DataView(b); v.setUint32(0,random(),true); v.setUint32(4,random(),true); return v.getFloat64(0,true); };
    const pairs: [number,number][] = [...selfTestPairs];
    const edges = [0,-0,Number.MIN_VALUE,-Number.MIN_VALUE,2**-1022,-(2**-1022),Number.MAX_VALUE,-Number.MAX_VALUE,Infinity,-Infinity,NaN,1,-1,2**-53,1+2**-52];
    for(const a of edges)for(const b of edges)pairs.push([a,b]);
    for(let i=0;i<1800;i++)pairs.push([number(),number()]);
    for(let i=0;i<1200;i++){
      const exponent=(random()%2000)-1000,a=(1+random()/2**32)*2**exponent;
      pairs.push([a,-a*(1+(random()%32)*Number.EPSILON)],[a,2**(exponent-(random()%64))]);
    }
    for(let e=-1074;e<=1023;e+=7){const a=2**e;pairs.push([a,a*(1-2**-52)],[a,-a],[a,3],[a,2**-53]);}
    try {
      const failures = await renderer.verifyArithmetic(pairs);
      return { failures: failures.slice(0,20), count: failures.length, operations: pairs.length*4 };
    } finally { renderer.dispose(); }
  });
  expect(result.operations).toBeGreaterThan(10_000);
  expect(result, JSON.stringify(result)).toMatchObject({ failures: [], count: 0 });
});

test('precise kernels match binary64 CPU outcomes and preserve color-only computation cache', async ({ page }) => {
  test.setTimeout(600_000);
  page.on('console', message => { if(message.type()==='info'||message.type()==='warning')console.log(message.type()+': '+message.text()); });
  await page.goto('/src/rendering/binary64.ts');
  const result = await page.evaluate(async () => {
    const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',ep='/src/domain/reference.ts';
    const { FractalRenderer }=await import(rp),{ fractals,createScene }=await import(cp),{ evaluatePoint }=await import(ep);
    const renderer=new FractalRenderer(document.createElement('canvas')),failures: string[]=[],timings: Record<string,number>={};
    try {
      renderer.resize(1,1);
      for(const definition of fractals){
        console.info('Checking '+definition.id);
        const id=definition.id,scene=createScene(id);scene.iterations=128;
        const started=performance.now();
        const points=id==='newton'?[[1,0],[0,0],[.6,.4],[-.4,.7]]:id==='nova'?[[0,0],[1e-7,0],[-1,0],[.1,.1]]:id==='magnet-1'?[[2,0],[1,0],[2.01,0],[-1,.5]]:[[0,0],[3,3],[-.7,.2],[.4,.3]];
        for(const [x,y] of points){
          scene.camera={x,y,height:1};await renderer.refine(scene);
          const cpu=evaluatePoint(id,x,y,scene.iterations,scene.parameters),gpu=renderer.readPoint(0,0);
          if(cpu.status!==gpu.status||cpu.root!==gpu.root||(['escaped','converged'].includes(cpu.status)&&Math.abs(cpu.value-gpu.value)>2/256))failures.push(`${id}(${x},${y}) CPU=${JSON.stringify(cpu)} GPU=${JSON.stringify(gpu)}`);
        }
        const computations=renderer.stats.computations;scene.coloring.phase=.4;renderer.draw(scene,true);
        if(renderer.stats.computations!==computations)failures.push(`${id}: color recomputed`);
        timings[id]=performance.now()-started;
      }
      for(const iterations of [64,2048,16384]){
        const scene=createScene('mandelbrot');scene.camera={x:0,y:0,height:1};scene.iterations=iterations;
        await renderer.refine(scene);const actual=renderer.readPoint(0,0);
        if(actual.status!=='unresolved'||actual.value!==iterations)failures.push(`Iteration limit ${iterations}: ${JSON.stringify(actual)}`);
      }
      for(let power=3;power<=8;power++)for(let root=0;root<power;root++){
        const scene=createScene('newton');scene.parameters.power=power;scene.camera={x:Math.cos(2*Math.PI*root/power),y:Math.sin(2*Math.PI*root/power),height:1};
        await renderer.refine(scene);const actual=renderer.readPoint(0,0);
        if(actual.status!=='converged'||actual.root!==root||actual.value!==0)failures.push(`Newton p${power} root${root}: ${JSON.stringify(actual)}`);
      }
      for(const [id,x,y,status] of [['nova',0,0,'converged'],['phoenix',5,0,'escaped'],['magnet-1',2.01,0,'escaped']] as const){
        const scene=createScene(id);scene.camera={x,y,height:1};scene.iterations=1;await renderer.refine(scene);
        if(renderer.readPoint(0,0).status!==status)failures.push(`${id}: missed last update`);
      }
      const deep=createScene();deep.camera={x:-2,y:0,height:1e-10};deep.iterations=64;renderer.resize(17,1);await renderer.refine(deep);
      let escaped=0,unresolved=0;
      for(let x=0;x<17;x++){
        const px=deep.camera.x+(x+.5-17/2)*deep.camera.height;
        const cpu=evaluatePoint('mandelbrot',px,0,64,deep.parameters),gpu=renderer.readPoint(x,0);
        if(cpu.status!==gpu.status)failures.push(`deep neighboring pixel ${x}: ${cpu.status} vs ${gpu.status}`);
        if(gpu.status==='escaped')escaped++;else unresolved++;
      }
      if(!escaped||!unresolved)failures.push('deep neighboring pixels collapsed');
      return { failures,timings };
    }finally{renderer.dispose();}
  });
  console.log(JSON.stringify(result.timings));
  expect(result.failures).toEqual([]);
});

test('cancelling a partially computed field preserves the front and never publishes obsolete work',async({page})=>{
  await page.goto('/src/rendering/binary64.ts');
  const result=await page.evaluate(async()=>{
    const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts';const {FractalRenderer}=await import(rp),{createScene}=await import(cp);
    const renderer=new FractalRenderer(document.createElement('canvas'));
    try{
      renderer.resize(64,64);const base=createScene();base.iterations=64;base.camera={x:3,y:3,height:.1};await renderer.refine(base);
      const front=renderer.readPoint(32,32),old=createScene(),next=createScene('julia');next.iterations=64;next.camera={x:3,y:3,height:1e-9};
      let replacement:Promise<void>|undefined,unchanged=false;
      const first=renderer.refine(old,()=>{if(replacement)return;unchanged=JSON.stringify(renderer.readPoint(32,32))===JSON.stringify(front);replacement=renderer.refine(next);});
      let cancelled=false;try{await first;}catch{cancelled=true;}await replacement;
      return {cancelled,unchanged,current:renderer.isPrecise(next),id:renderer.stats.fractalId,status:renderer.readPoint(32,32).status};
    }finally{renderer.dispose();}
  });
  expect(result).toEqual({cancelled:true,unchanged:true,current:true,id:'julia',status:'escaped'});
});

test('binary64 self-test is deferred until PNG export and does not disable preview',async({page})=>{
  await page.addInitScript(()=>{const original=WebGL2RenderingContext.prototype.shaderSource;WebGL2RenderingContext.prototype.shaderSource=function(shader,source){return original.call(this,shader,source.includes('uniform highp usampler2D u_inputs')?source.replace('r=dadd(a,b)','r=dsub(a,b)'):source);};});
  await page.setViewportSize({width:320,height:240});await page.goto('/?debug=1');await page.waitForFunction(()=>window.__FRACTOL__?.stats());
  const scene=await page.evaluate(()=>window.__FRACTOL__!.scene());
  await expect.poll(()=>page.evaluate(()=>{const stats=window.__FRACTOL__!.stats() as {viewing:{ready:boolean;arithmetic:string}};return stats.viewing.ready&&['float32','double-single'].includes(stats.viewing.arithmetic);})).toBe(true);
  expect(await page.evaluate(()=>window.__FRACTOL__!.scene())).toEqual(scene);
  await page.locator('.export-button').click();await page.locator('.export-options button').nth(1).click();
  await page.locator('.dialog-card .dialog-action').click();
  await expect(page.locator('.notification')).toContainText('binary64',{timeout:30000});
  expect(await page.evaluate(()=>window.__FRACTOL__!.scene())).toEqual(scene);
});
test('PNG export reuses its cached binary64 field and rebuilds it after context restoration',async({page})=>{
  test.setTimeout(180000);await page.setViewportSize({width:320,height:240});await page.goto('/?debug=1');
  await page.waitForFunction(()=>window.__FRACTOL__?.stats());
  await page.evaluate(()=>{const scene=window.__FRACTOL__!.scene();scene.camera={x:3,y:3,height:.1};scene.iterations=64;window.__FRACTOL__!.setScene(scene);});
  await page.waitForFunction(()=>(window.__FRACTOL__!.stats() as {viewing:{ready:boolean}}).viewing.ready);
  await watchPrecisionPasses(page);
  const scene=await page.evaluate(()=>window.__FRACTOL__!.scene());
  const exportPng=async()=>{await page.locator('.export-button').click();await page.locator('.export-options button').nth(1).click();const pending=page.waitForEvent('download');await page.locator('.dialog-card .dialog-action').click();return readFile((await (await pending).path())!);};
  const first=await exportPng();expect(first.readUInt32BE(16)).toBeGreaterThan(0);expect(first.readUInt32BE(20)).toBeGreaterThan(0);
  const firstPasses=await page.evaluate(()=>(window as unknown as {pngRefinementProbe:{passes:number}}).pngRefinementProbe.passes);expect(firstPasses).toBeGreaterThan(0);
  await exportPng();expect(await page.evaluate(()=>(window as unknown as {pngRefinementProbe:{passes:number}}).pngRefinementProbe.passes)).toBe(firstPasses);
  const extension=await page.evaluateHandle(()=>(window.__FRACTOL__!.renderer() as {getContext():WebGL2RenderingContext}).getContext().getExtension('WEBGL_lose_context'));
  if(await extension.evaluate(ext=>!!ext)){
    await extension.evaluate(ext=>ext!.loseContext());await expect(page.locator('.canvas-message')).toBeVisible();
    await extension.evaluate(ext=>ext!.restoreContext());await expect(page.locator('.canvas-message')).toBeHidden({timeout:60000});
    await page.waitForFunction(()=>(window.__FRACTOL__!.stats() as {viewing:{ready:boolean}}).viewing.ready,undefined,{timeout:60000});
    const before=await page.evaluate(()=>(window as unknown as {pngRefinementProbe:{passes:number}}).pngRefinementProbe.passes);await page.waitForTimeout(300);expect(await page.evaluate(()=>(window as unknown as {pngRefinementProbe:{passes:number}}).pngRefinementProbe.passes)).toBe(before);
    await exportPng();expect(await page.evaluate(()=>(window as unknown as {pngRefinementProbe:{passes:number}}).pngRefinementProbe.passes)).toBeGreaterThan(firstPasses);
  }
  await extension.dispose();expect(await page.evaluate(()=>window.__FRACTOL__!.scene())).toEqual(scene);
});
test('exact PNG cancellation unlocks controls and overview adoption remains an explicit history action',async({page})=>{
  await page.setViewportSize({width:320,height:240});await page.goto('/?debug=1');await page.waitForFunction(()=>window.__FRACTOL__?.stats());
  const scene=await page.evaluate(()=>{window.__FRACTOL__!.select('nova');const scene=window.__FRACTOL__!.scene();scene.camera={x:-.4886187166588625,y:.07824630200526818,height:1e-15};scene.iterations=16384;window.__FRACTOL__!.setScene(scene);return window.__FRACTOL__!.scene();});
  await page.locator('.export-button').click();await page.locator('.export-options button').nth(1).click();
  await page.locator('.dialog-card .dialog-action').click();await page.locator('.export-progress button').click();
  await expect(page.locator('.export-progress button')).toBeHidden();await expect(page.locator('.dialog-card .dialog-action')).toBeEnabled();
  expect(await page.evaluate(()=>window.__FRACTOL__!.scene())).toEqual(scene);
  await page.locator('.dialog-close').click();await page.getByTestId('adopt-overview').click();
  const adopted=await page.evaluate(()=>window.__FRACTOL__!.scene());expect(adopted.camera.height).toBeGreaterThan(scene.camera.height);
  await page.getByTestId('fractal-canvas').focus();await page.keyboard.press('Control+z');
  expect((await page.evaluate(()=>window.__FRACTOL__!.scene())).camera).toEqual(scene.camera);
});
test('resize and context restoration rebuild the current float32 or DS overview',async({page})=>{
  await page.setViewportSize({width:640,height:480});await page.goto('/?debug=1');await page.waitForFunction(()=>window.__FRACTOL__?.stats());
  await page.evaluate(()=>{window.__FRACTOL__!.select('julia');const scene=window.__FRACTOL__!.scene();scene.camera={x:3,y:3,height:1e-9};scene.iterations=64;window.__FRACTOL__!.setScene(scene);});
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>(window.__FRACTOL__!.stats() as {viewing:{ready:boolean;overview:boolean}}).viewing.ready,undefined,{timeout:60000});
  const scene=await page.evaluate(()=>window.__FRACTOL__!.scene());expect(scene.fractalId).toBe('julia');
  const extension=await page.evaluateHandle(()=>(window.__FRACTOL__!.renderer() as {getContext():WebGL2RenderingContext}).getContext().getExtension('WEBGL_lose_context'));
  if(await extension.evaluate(ext=>!!ext)){
    await extension.evaluate(ext=>ext!.loseContext());await expect(page.locator('.canvas-message')).toBeVisible();
    await extension.evaluate(ext=>ext!.restoreContext());await expect(page.locator('.canvas-message')).toBeHidden({timeout:60000});
    await page.waitForFunction(()=>(window.__FRACTOL__!.stats() as {viewing:{ready:boolean}}).viewing.ready,undefined,{timeout:60000});
  }
  await extension.dispose();
  expect(await page.evaluate(()=>window.__FRACTOL__!.scene())).toEqual(scene);
  expect(await page.evaluate(()=>{const s=window.__FRACTOL__!.stats() as {phase:string;viewing:{arithmetic:string;overview:boolean}};return {phase:s.phase,...s.viewing};})).toMatchObject({phase:'preview',arithmetic:'double-single',overview:true});
  expect(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
});
test('current benchmark records preview viewing arithmetic and restores the source scene',async({page})=>{
  test.setTimeout(120000);await page.setViewportSize({width:640,height:480});await page.goto('/?debug=1');await page.waitForFunction(()=>window.__FRACTOL__?.stats());
  const scene=await page.evaluate(()=>{const scene=window.__FRACTOL__!.scene();scene.camera={x:3,y:3,height:.1};window.__FRACTOL__!.setScene(scene);return scene;});
  const report=await page.evaluate(()=>window.__FRACTOL__!.benchmark('current',true));
  expect(report?.status).toBe('completed');expect(report?.method).toBe('fractol-navigation-v6-events');expect(report?.arithmeticVersion).toBeUndefined();expect(report?.results).toHaveLength(2);
  for(const row of report!.results){
    expect(row.precision).toBeUndefined();expect(row.arithmeticModes?.length).toBeGreaterThan(0);
    expect(row.arithmeticModes?.every(value=>value==='float32'||value==='double-single')).toBe(true);
    expect(row.effectiveIterations).toContain(scene.iterations);
    expect(row.completedFields).toBeGreaterThanOrEqual(0);expect(Number.isFinite(row.newFieldsPerSecond)).toBe(true);
  }
  expect(await page.evaluate(()=>window.__FRACTOL__!.scene())).toEqual(scene);
});

test('stopping the current preview benchmark preserves partial GPU samples and restores the scene',async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width:320,height:240});await page.goto('/?debug=1');await page.waitForFunction(()=>window.__FRACTOL__?.stats());
  await page.evaluate(()=>window.__FRACTOL__!.select('magnet-1'));
  const scene=await page.evaluate(()=>window.__FRACTOL__!.scene());
  const pending=page.evaluate(()=>window.__FRACTOL__!.benchmark('current',true));
  await expect(page.locator('.benchmark-progress')).toBeVisible({timeout:45000});await page.waitForTimeout(500);
  await page.getByRole('button',{name:/Stop|Стоп|Остановить/i}).click();
  const report=await pending,partial=report?.results[0];
  expect(report?.status).toBe('interrupted');expect(report?.method).toBe('fractol-navigation-v6-events');expect(partial?.status).toBe('interrupted');
  expect(partial?.precision).toBeUndefined();expect(partial?.gpuTimesMs).toHaveLength(partial!.gpuSamples);
  expect(partial!.gpuTimesMs!.every(ms=>Number.isFinite(ms)&&ms>=0)).toBe(true);
  const sorted=[...partial!.gpuTimesMs!].sort((a,b)=>a-b);
  expect(partial?.p50GpuMs).toBe(sorted.length?sorted[Math.floor(sorted.length*.5)]:null);
  expect(partial?.p95GpuMs).toBe(sorted.length?sorted[Math.floor(sorted.length*.95)]:null);
  expect(await page.evaluate(()=>window.__FRACTOL__!.scene())).toEqual(scene);
});
