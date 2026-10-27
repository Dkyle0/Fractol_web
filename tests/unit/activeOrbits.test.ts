import {describe,it,expect,vi} from 'vitest';
import {ACTIVE_ORBIT_MEMORY_LIMIT,canProbeActiveOrbits,shouldCompactOrbits} from '../../src/domain/activeOrbits';
import {ActiveOrbits} from '../../src/rendering/webgl/activeOrbits';

describe('active orbit compaction admission',()=>{
 it('keeps short fields and the start/end of a calculation unpacked',()=>{
  expect(shouldCompactOrbits(0,512,300,16384,null)).toBe(false);
  expect(shouldCompactOrbits(63,512,300,16384,null)).toBe(false);
  expect(shouldCompactOrbits(64,64,300,16384,null)).toBe(false);
  expect(shouldCompactOrbits(449,512,300,16384,null)).toBe(false);
 });
 it('requires a useful active population within the active fraction and respects the prior count',()=>{
  expect(shouldCompactOrbits(64,512,255,16384,null)).toBe(false);
  expect(shouldCompactOrbits(64,512,256,16384,null)).toBe(true);
  expect(shouldCompactOrbits(64,512,4096,16384,null)).toBe(true);
  expect(shouldCompactOrbits(64,512,4097,16384,null)).toBe(false);
  expect(shouldCompactOrbits(64,512,1025,16384,4096)).toBe(false);
  expect(shouldCompactOrbits(64,512,1024,16384,4096)).toBe(true);
 });
 it('exports the bounded scratch-memory budget used by the allocator',()=>{
  expect(ACTIVE_ORBIT_MEMORY_LIMIT).toBe(8*1024*1024);
 });
 it('stops density probes when too few pixels remain, no useful active population remains, or prior packing made another probe pointless',()=>{
  expect(canProbeActiveOrbits(64,256,null)).toBe(true);
  expect(canProbeActiveOrbits(63,256,null)).toBe(false);
  expect(canProbeActiveOrbits(64,255,null)).toBe(false);
  expect(canProbeActiveOrbits(64,256,1023)).toBe(false);
  expect(canProbeActiveOrbits(64,256,1024)).toBe(true);
  expect(canProbeActiveOrbits(512,16384,null)).toBe(true);
 });
});

describe('active orbit asynchronous counter lifecycle',()=>{
 function pendingCounter(status:number,ensureActive=vi.fn()){
  const gl:any={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,CONDITION_SATISFIED:3,ALREADY_SIGNALED:4,PIXEL_PACK_BUFFER:5,NO_ERROR:0,
   clientWaitSync:vi.fn(()=>status),deleteSync:vi.fn(),deleteBuffer:vi.fn(),deleteTexture:vi.fn(),deleteFramebuffer:vi.fn(),bindBuffer:vi.fn(),getBufferSubData:vi.fn((_target:number,_offset:number,result:Uint32Array)=>{result[0]=731;}),getError:vi.fn(()=>0),isContextLost:vi.fn(()=>false)};
  const context:any={gl,resources:{scratchBytes:0},measurements:{poll:vi.fn()},stats:{},ensureActive,canRelease:()=>true};
  const activity=new ActiveOrbits(context,1),sync={} as WebGLSync;
  (activity as any).pbo={};(activity as any).counter={sync,started:performance.now(),polls:0};
  return{activity,context,gl,sync};
 }
 it('reads a completed pending counter once and clears its fence',()=>{
  const {activity,gl,sync}=pendingCounter(3),signal=new AbortController().signal;
  try{expect(activity.countPending).toBe(true);expect(activity.pollCount(signal)).toBe(731);
   expect(activity.countPending).toBe(false);expect(gl.deleteSync).toHaveBeenCalledWith(sync);
   expect(gl.getBufferSubData).toHaveBeenCalledTimes(1);
  }finally{activity.dispose();}
 });
 it('keeps a timed out counter pending without reading its PBO or allowing a duplicate submit',()=>{
  const {activity,gl}=pendingCounter(1),signal=new AbortController().signal;
  try{expect(activity.pollCount(signal)).toBeNull();expect(activity.countPending).toBe(true);
   expect(gl.getBufferSubData).not.toHaveBeenCalled();
   expect(()=>activity.submitCount({} as WebGLTexture,1,1,signal)).toThrow(/ещё не получен/);
   expect(gl.clientWaitSync).toHaveBeenCalledTimes(1);
  }finally{activity.dispose();}
 });
 it('drops a cancelled stale-generation counter without polling or reading the old GL context',()=>{
  const ensureActive=vi.fn(()=>{throw Error('stale generation');}),{activity,gl,sync}=pendingCounter(3,ensureActive),signal=new AbortController().signal;
  try{expect(()=>activity.pollCount(signal)).toThrow('stale generation');
   expect(gl.clientWaitSync).not.toHaveBeenCalled();expect(gl.getBufferSubData).not.toHaveBeenCalled();
   (activity as any).context.canRelease=()=>false;
   activity.discardCount();expect(activity.countPending).toBe(false);
   expect(gl.deleteSync).not.toHaveBeenCalledWith(sync);
  }finally{activity.dispose();}
 });
 it('does not touch GL after cancellation before polling a pending counter',()=>{
  const {activity,gl}=pendingCounter(3),controller=new AbortController();controller.abort();
  try{expect(()=>activity.pollCount(controller.signal)).toThrow();expect(gl.clientWaitSync).not.toHaveBeenCalled();expect(gl.getBufferSubData).not.toHaveBeenCalled();}
  finally{activity.dispose();}
 });
});
