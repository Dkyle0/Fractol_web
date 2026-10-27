import {describe,it,expect,vi,afterEach} from 'vitest';
import {createScene} from '../../src/domain/catalog';
import {copyScene} from '../../src/domain/types';
import {RenderSession,type SessionClock} from '../../src/rendering/session';
import type {FieldRequest} from '../../src/rendering/backend';
import type {GpuMeasurement} from '../../src/domain/quality';
import {FakeBackend} from './fakeBackend';

class FakeClock implements SessionClock {
  time=0;sequence=0;frames=new Map<number,FrameRequestCallback>();
  pending:{at:number;resolve:()=>void}[]=[];
  now=()=>this.time;dpr=()=>1;
  requestFrame=(callback:FrameRequestCallback)=>{this.frames.set(++this.sequence,callback);return this.sequence;};
  cancelFrame=(id:number)=>{this.frames.delete(id);};
  wait=(ms:number)=>new Promise<void>(resolve=>{this.pending.push({at:this.time+ms,resolve});});
  async tick(ms=1000/120){
    this.time+=ms;
    const due=this.pending.filter(item=>item.at<=this.time);this.pending=this.pending.filter(item=>item.at>this.time);
    due.forEach(item=>item.resolve());for(let i=0;i<15;i++)await Promise.resolve();
    const frames=[...this.frames.values()];this.frames.clear();frames.forEach(callback=>callback(this.time));
    for(let i=0;i<15;i++)await Promise.resolve();
  }
}
const sessions:RenderSession[]=[];
afterEach(()=>{sessions.forEach(session=>session.dispose());sessions.length=0;});
function setup(){
  const clock=new FakeClock(),backend=new FakeBackend(),scene=createScene(),callbacks={stats:vi.fn(),loading:vi.fn(),error:vi.fn(),lightGlass:vi.fn()};
  const served:FieldRequest[]=[],completed:FieldRequest[]=[];
  backend.preview=async request=>{
    const snapshot={...request,scene:copyScene(request.scene)};served.push(snapshot);
    await clock.wait(40);completed.push(snapshot);backend.stats.draws++;
    for(const listener of backend.fields)listener({job:request.job,arithmetic:'double-single',width:100,height:100,progress:1,complete:true});
  };
  const measurements=new Set<(sample:GpuMeasurement)=>void>();
  Object.assign(backend,{subscribeMeasurements:(listener:(sample:GpuMeasurement)=>void)=>{measurements.add(listener);return()=>{measurements.delete(listener);};}});
  const session=new RenderSession(backend,scene,callbacks,clock);sessions.push(session);session.resize({width:100,height:100});
  return {session,clock,backend,scene,served,completed,callbacks,measurements};
}
describe('bounded asynchronous preview coalescing',()=>{
  it('serves immutable snapshots during 120Hz input and eventually serves the latest camera',async()=>{
    const {session,clock,backend,scene,served,completed,callbacks}=setup();
    session.interact();await clock.tick();await clock.tick();
    const cancel=vi.spyOn(backend,'cancelRefinement');
    for(let i=0;i<36;i++){scene.camera.x+=.001;session.update(scene,true);await clock.tick();}
    expect(cancel).not.toHaveBeenCalled();expect(completed.length).toBeGreaterThan(4);
    expect(served.length).toBeLessThan(12);expect(served[0]!.scene.camera.x).toBe(createScene().camera.x);
    for(let i=0;i<35;i++)await clock.tick();
    expect(completed.some(request=>request.scene.camera.x===scene.camera.x)).toBe(true);
    expect(session.getViewState().requestedCamera).toEqual(scene.camera);expect(session.getViewState().ready).toBe(true);expect(callbacks.error).not.toHaveBeenCalled();
    expect(clock.frames.size).toBe(0);
  });
  it.each(['jump','iterations','formula','power'] as const)('immediately cancels active preview for a %s change',async change=>{
    const {session,clock,backend,scene}=setup();session.interact();await clock.tick();await clock.tick();
    const cancel=vi.spyOn(backend,'cancelRefinement');
    if(change==='jump')scene.camera.x+=scene.camera.height*2;
    if(change==='iterations')scene.iterations=1024;
    if(change==='formula')scene.fractalId='julia';
    if(change==='power')scene.parameters.power++;
    session.update(scene,true);expect(cancel).toHaveBeenCalledOnce();
  });
  it('disposes field and measurement subscriptions and ignores a late asynchronous completion',async()=>{
    const {session,clock,backend,measurements,callbacks}=setup();await clock.tick();await clock.tick();
    expect(backend.fields.size).toBe(1);expect(measurements.size).toBe(1);
    session.dispose();expect(backend.fields.size).toBe(0);expect(measurements.size).toBe(0);
    await clock.tick(100);expect(clock.frames.size).toBe(0);expect(callbacks.error).not.toHaveBeenCalled();
  });
  it('returns to full resolution after a preview outlasts the final gesture',async()=>{
    const {session,clock,backend}=setup();
    backend.preview=()=>clock.wait(240);
    const resize=vi.spyOn(backend,'resize');session.setQualityProfile('performance');session.interact();
    await clock.tick();await clock.tick();expect(resize).toHaveBeenLastCalledWith(50,50,{width:100,height:100});
    for(let i=0;i<100;i++)await clock.tick();
    expect(resize).toHaveBeenLastCalledWith(100,100,{width:100,height:100});
    expect(session.getStats().phase).toBe('preview');expect(session.getViewState().ready).toBe(true);expect(clock.frames.size).toBe(0);
  });
});
