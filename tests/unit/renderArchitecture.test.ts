import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScene } from '../../src/domain/catalog';
import { computeViewingPlan, doubleSingleViewingLimits } from '../../src/domain/viewing';
import { defaultRenderLimits, numericalMinimum } from '../../src/domain/renderLimits';
import { RenderJobs } from '../../src/rendering/jobs';
import { RenderSession, type SessionClock } from '../../src/rendering/session';
import { ExportService } from '../../src/rendering/exportService';
import { FakeBackend } from './fakeBackend';

describe('viewing arithmetic and job identity',()=>{
  it('uses bounded viewing arithmetic and a separate double-single navigation floor',()=>{
    const scene=createScene(),view={width:1000,height:700};
    scene.camera={x:-.5,y:0,height:1e-10};scene.iterations=1024;
    const plan=computeViewingPlan(scene,view,1);
    expect(plan.arithmetic).toBe('double-single');expect(plan.overview).toBe(true);
    expect(plan.minimumHeight).toBeGreaterThanOrEqual(1e-12);
    expect(plan.numericalLimits).toEqual(doubleSingleViewingLimits);
    expect(computeViewingPlan(createScene(),view,1).arithmetic).toBe('float32');
  });
  it('separates numerical limits from framebuffer budgets',()=>{
    expect(defaultRenderLimits).toEqual({maxDpr:1.5,maxPixels:3000000});
    expect(numericalMinimum({x:0,y:0,height:1},1080)).toBe(6*2**-52*1080);
    expect(numericalMinimum({x:0,y:0,height:1},1080,{bits:23,minimum:1e-5,safety:6,referenceHeight:1})).toBeGreaterThan(1e-5);
  });
  it('rejects old revisions, replaced jobs and former context generations',()=>{
    const jobs=new RenderJobs(),first=jobs.begin('refine'),second=jobs.begin('refine');
    expect(jobs.current(first)).toBe(false);expect(jobs.current(second)).toBe(true);
    jobs.invalidate();expect(jobs.current(second)).toBe(false);
    const before=jobs.begin('prepare');jobs.transition('context-lost');jobs.transition('active');
    const after=jobs.begin('prepare');expect(jobs.current(before)).toBe(false);expect(after.contextGeneration).toBe(before.contextGeneration+1);
    jobs.transition('disposed');jobs.transition('active');expect(jobs.current(after)).toBe(false);
  });
  it('rejects unsupported export arithmetic before invoking the backend',async()=>{
    const backend=new FakeBackend(),run=vi.spyOn(backend,'exportFrame');
    await expect(new ExportService(backend).run({scene:createScene(),width:10,height:10,arithmetic:'float32',job:new RenderJobs().begin('export')})).rejects.toThrow('точность');
    expect(run).not.toHaveBeenCalled();
  });
  it('checks export limits and releases the reserved CPU buffers after an error',async()=>{
    const backend=new FakeBackend(),service=new ExportService(backend),request={scene:createScene(),width:100,height:100,arithmetic:'binary64' as const,job:new RenderJobs().begin('export')};
    const run=vi.spyOn(backend,'exportFrame');await expect(service.run({...request,width:5000})).rejects.toThrow('размер');expect(run).not.toHaveBeenCalled();
    let reject!:(error:Error)=>void;backend.exportFrame=()=>new Promise((_,fail)=>{reject=fail;});const pending=service.run(request);
    expect(service.getMemoryEstimate().exportCpuBufferBytes).toBe(80000);reject(new Error('encoder failed'));await expect(pending).rejects.toThrow('encoder failed');
    expect(service.getMemoryEstimate().exportCpuBufferBytes).toBe(0);
  });
});

describe('render session with an injected backend and clock',()=>{
  let backend:FakeBackend,session:RenderSession,frames:Map<number,FrameRequestCallback>,id:number;
  const callbacks={stats:vi.fn(),loading:vi.fn(),error:vi.fn(),lightGlass:vi.fn()};
  beforeEach(()=>{
    vi.useFakeTimers();frames=new Map();id=0;backend=new FakeBackend();
    const clock:SessionClock={now:()=>performance.now(),requestFrame:cb=>{frames.set(++id,cb);return id;},cancelFrame:key=>{frames.delete(key);},dpr:()=>1,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))};
    Object.values(callbacks).forEach(fn=>fn.mockClear());session=new RenderSession(backend,createScene(),callbacks,clock);session.resize({width:100,height:100});
  });
  afterEach(()=>{session.dispose();vi.useRealTimers();});
  async function tick(){vi.advanceTimersByTime(17);const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(performance.now());for(let i=0;i<15;i++)await Promise.resolve();}
  it('keeps ordinary viewing on float32 or double-single and never refines to binary64',async()=>{
    const refine=vi.spyOn(backend,'refineField'),prepare=vi.spyOn(backend,'prepare');
    await tick();await tick();expect(refine).not.toHaveBeenCalled();
    const view=session.getViewState();expect(['float32','double-single']).toContain(view.arithmetic);
    expect(prepare).toHaveBeenCalledWith('mandelbrot','float32');
    const lease=session.acquireOperation('benchmark');await tick();lease.release();
    session.contextLost();session.contextRestored();await tick();await tick();
    expect(refine).not.toHaveBeenCalled();
  });
  it('keeps a deep requested camera in the scene while exposing a safe ready overview copy',async()=>{
    const refine=vi.spyOn(backend,'refineField');
    const scene=createScene();scene.camera={x:-.65,y:.2,height:1e-15};scene.iterations=2048;
    session.update(scene);const requested=session.getViewState();
    expect(requested.requestedCamera).toEqual(scene.camera);expect(requested.overview).toBe(true);
    expect(requested.camera.height).toBeGreaterThan(scene.camera.height);
    const exposed=session.getViewState();exposed.camera.x=19;expect(session.getViewState().camera.x).not.toBe(19);
    await tick();await tick();expect(session.getViewState().ready).toBe(true);
    expect(session.getViewState().requestedCamera).toEqual(scene.camera);
    expect(refine).not.toHaveBeenCalled();
  });
  it('adapts the field while keeping the visible surface at final resolution',async()=>{
    const resize=vi.spyOn(backend,'resize');session.setQualityProfile('performance');session.interact();
    await tick();await tick();
    expect(resize).toHaveBeenLastCalledWith(50,50,{width:100,height:100});
    vi.advanceTimersByTime(200);await tick();
    expect(resize).toHaveBeenLastCalledWith(100,100,{width:100,height:100});
  });
  it('renders the selected iteration count while moving and after settling',async()=>{
    const preview=vi.spyOn(backend,'preview'),scene=createScene();scene.iterations=513;session.update(scene);session.interact();
    await tick();await tick();expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({scene:expect.objectContaining({iterations:513})}));
    vi.advanceTimersByTime(200);await tick();
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({scene:expect.objectContaining({iterations:513})}));
    expect(session.getViewState().ready).toBe(true);
  });
  it('does not cancel an in-flight selected-N preview for interaction alone',async()=>{
    let finish!:()=>void;backend.preview=()=>new Promise<void>(resolve=>{finish=resolve;});
    const cancel=vi.spyOn(backend,'cancelRefinement'),scene=createScene();scene.iterations=3584;session.update(scene);
    cancel.mockClear();
    await tick();await tick();expect(backend.fields.size).toBe(1);
    session.interact();await tick();
    expect(cancel).not.toHaveBeenCalled();expect(backend.fields.size).toBe(1);
    finish();for(let i=0;i<15;i++)await Promise.resolve();
  });
  it('does not redraw for an identical scene or viewport',async()=>{
    const preview=vi.spyOn(backend,'preview'),recolor=vi.spyOn(backend,'recolor');
    await tick();await tick();preview.mockClear();recolor.mockClear();
    session.update(createScene());session.resize({width:100,height:100});await tick();await tick();
    expect(preview).not.toHaveBeenCalled();expect(recolor).not.toHaveBeenCalled();
  });
  it('quality profile at final scale reuses the ready field without preview or recolor',async()=>{
    const preview=vi.spyOn(backend,'preview'),recolor=vi.spyOn(backend,'recolor');
    await tick();await tick();vi.advanceTimersByTime(200);await tick();
    preview.mockClear();recolor.mockClear();session.setQualityProfile('quality');await tick();await tick();
    expect(preview).not.toHaveBeenCalled();expect(recolor).not.toHaveBeenCalled();
  });
  it('publishes an already-drawn progressive field without recoloring it again',async()=>{
    let job!:Parameters<NonNullable<typeof backend.preview>>[0]['job'];let finish!:()=>void;
    backend.preview=request=>{job=request.job;return new Promise<void>(resolve=>{finish=resolve;});};
    const recolor=vi.spyOn(backend,'recolor'),framesSeen=vi.fn();session.subscribe(framesSeen);
    const scene=createScene();scene.camera={x:3,y:3,height:1e-6};session.update(scene);
    await tick();await tick();expect(job).toBeDefined();
    backend.stats.draws++;
    for(const notify of backend.fields)notify({job,arithmetic:'double-single',width:100,height:100,progress:.5,complete:false});
    await tick();
    expect(recolor).not.toHaveBeenCalled();expect(framesSeen).toHaveBeenCalled();
    finish();for(let i=0;i<15;i++)await Promise.resolve();
  });
  it('treats a rejected preview as terminal while idle and retries after a scene change or restore',async()=>{
    const preview=vi.spyOn(backend,'preview').mockImplementation(()=>Promise.reject(new Error('preview failed')));
    await tick();await tick();await tick();expect(preview).toHaveBeenCalledTimes(1);
    expect(callbacks.error).toHaveBeenCalledTimes(1);expect(frames.size).toBe(0);

    const changed=createScene();changed.camera.x+=.1;session.update(changed);await tick();await tick();
    expect(preview).toHaveBeenCalledTimes(2);
    session.contextLost();session.contextRestored();await tick();await tick();await tick();
    expect(preview).toHaveBeenCalledTimes(3);
    expect(callbacks.error).toHaveBeenCalledTimes(3);
    expect(frames.size).toBe(0);
  });
  it('ignores a late failure from a cancelled preview and keeps the replacement preview active',async()=>{
    let rejectA!:(error:Error)=>void,finishB!:()=>void;
    const aPreview=new Promise<void>((_,reject)=>{rejectA=reject;});
    const preview=vi.spyOn(backend,'preview').mockImplementationOnce(()=>aPreview).mockImplementationOnce(()=>new Promise<void>(resolve=>{finishB=resolve;}));
    await tick();await tick();expect(preview).toHaveBeenCalledTimes(1);
    const next=createScene();next.camera.x+=.1;session.update(next);
    rejectA(new Error('stale preview failure'));await tick();await tick();expect(preview).toHaveBeenCalledTimes(2);
    expect(callbacks.error).not.toHaveBeenCalled();
    finishB();await tick();expect(callbacks.error).not.toHaveBeenCalled();
  });
  it('recomputes ready scene A after pending B replaces the backend front without a partial-field event',async()=>{
    session.setResourceMode('economy');
    const a=createScene();await tick();await tick();expect(session.getViewState().ready).toBe(true);
    let finishB!:()=>void;
    const preview=vi.spyOn(backend,'preview').mockImplementation(request=>{
      backend.stats.draws++;
      if(request.scene.camera.x===a.camera.x)return;
      return new Promise<void>(resolve=>{finishB=resolve;});
    });
    const b=createScene();b.camera.x+=.2;session.update(b);await tick();await tick();expect(finishB).toBeDefined();
    session.update(a);finishB();await tick();await tick();
    expect(preview.mock.calls.some(([request])=>request.scene.camera.x===a.camera.x)).toBe(true);
    expect(session.getViewState().ready).toBe(true);
  });
  it('recomputes A after a partial B field replaced its completed front, even when stale B later resolves',async()=>{
    const a=createScene();await tick();await tick();expect(session.getViewState().ready).toBe(true);
    const preview=vi.spyOn(backend,'preview');let bJob!:Parameters<FakeBackend['preview']>[0]['job'];let finishB!:()=>void;
    preview.mockImplementation(request=>{
      if(request.scene.camera.x!==a.camera.x){bJob=request.job;return new Promise<void>(resolve=>{finishB=resolve;});}
      backend.stats.draws++;return undefined;
    });
    const b=createScene();b.camera={...b.camera,x:a.camera.x+.2};session.update(b);
    await tick();await tick();expect(bJob).toBeDefined();
    backend.stats.draws++;
    for(const notify of backend.fields)notify({job:bJob,arithmetic:'double-single',width:100,height:100,progress:.25,complete:false});
    await tick();
    session.update(a);finishB();for(let i=0;i<15;i++)await Promise.resolve();
    await tick();await tick();
    expect(preview.mock.calls.some(([request])=>request.scene.camera.x===a.camera.x)).toBe(true);
    expect(session.getViewState().requestedCamera).toEqual(a.camera);
  });
  it('waits for an asynchronous preview and drops its late completion after disposal',async()=>{
    let done!:()=>void;backend.preview=()=>new Promise<void>(resolve=>{done=resolve;});
    const refine=vi.spyOn(backend,'refineField');await tick();await tick();expect(refine).not.toHaveBeenCalled();
    expect(backend.fields.size).toBe(1);session.dispose();expect(backend.fields.size).toBe(0);done();
    for(let i=0;i<15;i++)await Promise.resolve();expect(frames.size).toBe(0);expect(refine).not.toHaveBeenCalled();
  });
  it('does not publish a frame when an asynchronous preview has not drawn anything',async()=>{
    backend.preview=()=>Promise.resolve();const listener=vi.fn(),lease=session.acquireOperation('benchmark');session.subscribe(listener);
    await tick();await tick();await tick();expect(listener).not.toHaveBeenCalled();lease.release();
  });
  it('restores the profile and policy; old release cannot close a new lease',async()=>{
    session.setQualityProfile('performance');const lease=session.acquireOperation('benchmark');session.setQualityProfile('quality');
    expect(()=>session.acquireOperation('export')).toThrow();lease.release();expect(session.getQualityProfile()).toBe('performance');
    const next=session.acquireOperation('export');lease.release();expect(next.signal.aborted).toBe(false);next.release();
  });
  it('keeps context loss suspended while hidden and restarts after visibility',async()=>{
    await tick();session.contextLost();session.visibility(true);session.contextRestored();expect(frames.size).toBe(0);expect(backend.visible).toBe(false);
    session.visibility(false);expect(backend.visible).toBe(true);await tick();await tick();expect(backend.stats.draws).toBeGreaterThan(0);
  });
  it('aborts export on suspension and restores operation ownership after rejection',async()=>{
    backend.exportFrame=(_request,signal)=>new Promise((_,reject)=>signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true}));
    const exported=session.export(10,10);for(let i=0;i<10;i++)await Promise.resolve();session.visibility(true);
    await expect(exported).rejects.toThrow('Вкладка');session.visibility(false);
    const lease=session.acquireOperation('benchmark');lease.release();
  });
  it('cancels export while it is waiting for a pending preview',async()=>{
    let finishPreview!:()=>void;backend.preview=()=>new Promise<void>(resolve=>{finishPreview=resolve;});const preview=vi.spyOn(backend,'preview');
    await tick();await tick();expect(preview).toHaveBeenCalled();expect(backend.fields.size).toBe(1);
    const exportFrame=vi.spyOn(backend,'exportFrame'),exported=session.export(10,10);
    for(let i=0;i<10;i++)await Promise.resolve();session.visibility(true);
    await expect(exported).rejects.toThrow('Вкладка');expect(exportFrame).not.toHaveBeenCalled();
    finishPreview();session.visibility(false);
  });
  it('exports an independent scene snapshot and restores after an encoder error',async()=>{
    const scene=createScene();session.update(scene);let snapshot!:typeof scene;
    backend.exportFrame=async request=>{snapshot=request.scene;throw new Error('encoder failed');};
    const exported=session.export(10,10);scene.camera.x=15;await expect(exported).rejects.toThrow('encoder failed');expect(snapshot.camera.x).not.toBe(15);
    session.acquireOperation('benchmark').release();
  });
  it('exports an iteration override from a snapshot without changing the viewing scene',async()=>{
    const scene=createScene();scene.iterations=512;scene.camera={x:3,y:3,height:.1};session.update(scene);
    const exportFrame=vi.spyOn(backend,'exportFrame');
    await session.export(10,10,undefined,undefined,{iterations:16384});
    expect(exportFrame).toHaveBeenCalledWith(expect.objectContaining({scene:expect.objectContaining({iterations:16384})}),expect.anything(),undefined);
    expect(session.getViewState().requestedIterations).toBe(512);
    exportFrame.mockClear();
    await session.export(10,10);
    expect(exportFrame).toHaveBeenCalledWith(expect.objectContaining({scene:expect.objectContaining({iterations:512})}),expect.anything(),undefined);
    expect(session.getViewState().requestedIterations).toBe(512);
  });
  it.each([63,16385,64.5,Number.NaN])('rejects invalid export iteration count %s before backend and releases operation',async iterations=>{
    const run=vi.spyOn(backend,'exportFrame');
    await expect(session.export(10,10,undefined,undefined,{iterations})).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(()=>session.acquireOperation('benchmark').release()).not.toThrow();
  });
  it('releases subscriptions, pending frames and resources on disposal',async()=>{
    const listener=vi.fn(),dispose=vi.spyOn(backend,'dispose');session.subscribe(listener);session.dispose();session.dispose();expect(frames.size).toBe(0);await tick();expect(listener).not.toHaveBeenCalled();expect(backend.disposed).toBe(true);expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('does not touch GPU resources when an operation releases after disposal',()=>{
    const lease=session.acquireOperation('export');session.dispose();const reset=vi.spyOn(backend,'resetMeasurement'),cancel=vi.spyOn(backend,'cancelRefinement');
    lease.release();expect(reset).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled();expect(lease.signal.aborted).toBe(true);
  });
  it('does not expose a mutable backend snapshot',()=>{
    backend.stats.gpuSample={id:1,ms:2,submittedAt:0,width:100,height:100};const stats=session.getStats();stats.width=999;stats.gpuSample!.ms=200;
    expect(session.getStats().width).not.toBe(999);expect(session.getStats().gpuSample!.ms).toBe(2);
  });
});
