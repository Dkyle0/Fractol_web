import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('precision-check');
import { chromium,firefox,webkit } from '@playwright/test';
import { mkdir, writeFile, access,readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const channel=process.env.BROWSER_CHANNEL||'chrome',output=process.env.PRECISION_OUTPUT||`precision-v1.4-${channel}`;
const appVersion=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
if(!/^[a-z0-9._-]+$/i.test(output))throw new Error('PRECISION_OUTPUT must be a filename without directories');
await mkdir(artifactsRoot,{recursive:true});
try { await access(`${artifactsRoot}/${output}.json`);throw new Error('Output exists; select a new PRECISION_OUTPUT'); } catch(error){if(error.code!=='ENOENT')throw error;}
const width=Number(process.env.PRECISION_WIDTH||1920),height=Number(process.env.PRECISION_HEIGHT||1080);
const ids=process.env.PRECISION_FRACTALS?.split(',')||null,deep=process.env.PRECISION_DEEP==='1';
const gpuLoad=()=>{try{return execFileSync('nvidia-smi.exe',['--query-gpu=name,utilization.gpu,power.draw','--format=csv,noheader'],{windowsHide:true,encoding:'utf8'}).trim();}catch{return null;}};
const metadata={recordedAt:new Date().toISOString(),appVersion,channel,cpu:os.cpus()[0]?.model,os:`${os.platform()} ${os.release()}`,backgroundBefore:gpuLoad(),conditions:'Isolated renderer, no glass/compositing; not a navigation benchmark or acceptance of weaker hardware'};
let checkpoint={...metadata,status:'running',results:[]};
// The path is claimed once. Later writes belong to this run, never an older report.
await writeFile(`${artifactsRoot}/${output}.json`,JSON.stringify(checkpoint,null,2),{flag:'wx'});
let browser;
try{
  browser=await (channel==='firefox'?firefox.launch({headless:true}):channel==='webkit'?webkit.launch({headless:true}):chromium.launch({channel,headless:true}));
  checkpoint.browser=browser.version();
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  await page.exposeFunction('precisionCheckpoint',async(result,details)=>{
    checkpoint={...checkpoint,...details,results:[...checkpoint.results,result]};
    await writeFile(`${artifactsRoot}/${output}.json`,JSON.stringify(checkpoint,null,2));
  });
  page.on('console',message=>{if(message.type()==='info')console.log(message.text());});
  await page.goto('http://127.0.0.1:5173/src/rendering/binary64.ts');
  const report=await page.evaluate(async({width,height,ids,deep})=>{
    const rp='/src/rendering/renderer.ts',cp='/src/domain/catalog.ts',bp='/src/rendering/binary64.ts',ep='/src/domain/reference.ts';
    const {FractalRenderer}=await import(rp),{fractals,createScene}=await import(cp),{ARITHMETIC_VERSION}=await import(bp),{evaluatePoint}=await import(ep);
    const renderer=new FractalRenderer(document.createElement('canvas')),results=[];
    console.info(JSON.stringify(renderer.getCapabilities()));
    try{
      renderer.resize(width,height);
      for(const f of fractals.filter(f=>!ids||ids.includes(f.id)))for(const mode of deep?['start','deep']:['start']){
        const scene=createScene(f.id);if(mode==='deep')scene.camera.height/=1e7;
        const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(new Error('Точный кадр не завершён за 120 секунд.')),120000);
        let progress=0,lastPrint=-Infinity,lastId=renderer.stats.gpuSampleId;const gpuSamples=[],fenceSamples=[];
        const started=performance.now();let prepareMs=null,status='completed',reason='';
        console.info(`Precision ${f.id} ${mode} ${width}x${height}`);
        try{
          await renderer.prepare(f.id,'binary64');prepareMs=performance.now()-started;renderer.resetMeasurement();
          await renderer.refine(scene,fraction=>{
            progress=fraction;const sample=renderer.stats.gpuSample;
            if(renderer.stats.tileTiming==='fence')fenceSamples.push({latencyMs:renderer.stats.tileLatencyMs,polls:renderer.stats.tilePolls,pixels:renderer.stats.tilePixels,baselineMs:renderer.stats.fenceBaselineMs});
            if(sample&&sample.id>lastId){gpuSamples.push({...sample});lastId=sample.id;}
            if(performance.now()-lastPrint>2000){console.info(`${f.id}: ${Math.floor(fraction*100)}% · ${JSON.stringify({pixels:renderer.stats.tilePixels,timing:renderer.stats.tileTiming,gpu:renderer.stats.gpuMs,fence:renderer.stats.tileLatencyMs,baseline:renderer.stats.fenceBaselineMs,id:renderer.stats.gpuSampleId})}`);lastPrint=performance.now();}
          },abort.signal);
        }catch(error){status='interrupted';reason=error instanceof Error?error.message:String(error);}
        finally{clearTimeout(timeout);}
        const durationMs=performance.now()-started,checks=[];
        if(status==='completed')for(const [fx,fy] of [[.1,.1],[.5,.5],[.8,.7]]){
          const x=Math.floor(width*fx),y=Math.floor(height*fy),px=scene.camera.x+(x+.5-width/2)*scene.camera.height/height,py=scene.camera.y+(y+.5-height/2)*scene.camera.height/height;
          const cpu=evaluatePoint(f.id,px,py,scene.iterations,scene.parameters),gpu=renderer.readPoint(x,y);checks.push({pixel:[x,y],cpu,gpu});
        }
        const result={id:f.id,mode,status,reason,scene,width,height,prepareMs,durationMs,progress,gpuSamples,fenceSamples,checks};
        results.push(result);
        await window.precisionCheckpoint(result,{method:'binary64-refinement-v1',arithmetic:ARITHMETIC_VERSION,capabilities:renderer.getCapabilities()});
        console.info(`${f.id} ${mode}: ${status}, ${(durationMs/1000).toFixed(2)}s`);
      }
      return {method:'binary64-refinement-v1',arithmetic:ARITHMETIC_VERSION,capabilities:renderer.getCapabilities(),results};
    }finally{renderer.dispose();}
  },{width,height,ids,deep});
  await writeFile(`${artifactsRoot}/${output}.json`,JSON.stringify({...checkpoint,...report,status:report.results.every(r=>r.status==='completed')?'completed':'interrupted',finishedAt:new Date().toISOString(),backgroundAfter:gpuLoad()},null,2));
  console.log(`Saved ${artifactsRoot}/${output}.json`);
  if(report.results.some(r=>r.status!=='completed'))process.exitCode=1;
}catch(error){
  await writeFile(`${artifactsRoot}/${output}.json`,JSON.stringify({...checkpoint,status:'interrupted',reason:error instanceof Error?error.message:String(error),finishedAt:new Date().toISOString(),backgroundAfter:gpuLoad()},null,2));
  throw error;
}finally{await browser?.close();}
