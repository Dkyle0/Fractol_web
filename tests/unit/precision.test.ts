import { describe, expect, it } from 'vitest';
import { doubleWords } from '../../src/rendering/binary64';
import { floatPreviewSafe, gestureCamera, minimumHeight, screenToWorld, zoomAt } from '../../src/domain/camera';
import { createScene } from '../../src/domain/catalog';
import { decodeScene, encodeScene, parseScene } from '../../src/domain/scene';
import { precisionMarkdown } from '../../src/domain/precisionMarkdown';
import type { BenchmarkReport } from '../../src/domain/benchmark';

describe('binary64 boundary and camera', () => {
  it.each([0,-0,1,-1,Math.PI,Number.MIN_VALUE,2**-1022,Number.MAX_VALUE,Infinity,-Infinity])('uploads exact bits for %s', value => {
    const [lo,hi]=doubleWords(value), b=new ArrayBuffer(8),v=new DataView(b);
    v.setUint32(0,lo,true);v.setUint32(4,hi,true);
    expect(Object.is(v.getFloat64(0,true),value)).toBe(true);
  });
  it('keeps sub-float32 neighboring samples distinct and clamps at the double budget', () => {
    const camera={x:-2,y:.1,height:1e-9},view={width:1920,height:1080};
    expect(floatPreviewSafe(camera,view)).toBe(false);
    const a=screenToWorld(camera,view,900,500),b=screenToWorld(camera,view,901,500);
    expect(a.x).not.toBe(b.x);expect(Math.fround(a.x)).toBe(Math.fround(b.x));
    const next=zoomAt(camera,view,901,500,1e-10);
    expect(next.height).toBeGreaterThanOrEqual(minimumHeight(next,view));
    expect(next.height).toBeLessThan(1e-10);
  });
  it('anchors deep zoom locally without subtracting large absolute coordinates', () => {
    const camera={x:-.743643887037151,y:.13182590420533,height:1e-9},view={width:1440,height:900};
    const next=zoomAt(camera,view,1111,222,.5),a=screenToWorld(camera,view,1111,222),b=screenToWorld(next,view,1111,222);
    expect(Math.abs(a.x-b.x)).toBeLessThanOrEqual(Number.EPSILON);
    expect(Math.abs(a.y-b.y)).toBeLessThanOrEqual(Number.EPSILON);
  });
  it('computes long gestures from one anchor rather than accumulated updates', () => {
    const camera={x:-.7,y:.2,height:1e-8},view={width:900,height:900},from={x:300,y:300};
    let result=camera;
    for(let i=1;i<=1000;i++)result=gestureCamera(camera,view,from,{x:300+i/10,y:300-i/20},1-i/2000);
    expect(result).toEqual(gestureCamera(camera,view,from,{x:400,y:250},.5));
    expect(camera).toEqual({x:-.7,y:.2,height:1e-8});
  });
  it('preserves schema and old scenes while extending accepted depth and manual iterations', () => {
    const old=createScene();expect(parseScene(old)).toEqual(old);
    const deep={...old,camera:{...old.camera,height:1e-12},iterations:16384};
    expect(decodeScene(encodeScene(deep))).toEqual(deep);
    expect(parseScene({...deep,iterations:16385})).toBeNull();
    expect(parseScene({...deep,iterations:64.5})).toBeNull();
    expect(parseScene({...deep,camera:{...deep.camera,height:1e-16}})).toBeNull();
  });
  it('labels preview separately and includes exact snapshots, failure reason and both resolutions', () => {
    const report={arithmeticVersion:'binary64-u32-v1',results:[{scene:createScene(),lightGlass:false,arithmeticModes:['float32'],executors:['double-single-tiled'],previewGenerators:['switch','structured'],precision:{arithmetic:'binary64-u32-v1',status:'interrupted',reason:'GPU <timeout>',durationMs:120000,computeResolution:'320×180',displayResolution:'1920×1080',scene:createScene(),gpuSamples:0,p50GpuMs:null,p95GpuMs:null}}]} as BenchmarkReport;
    const md=precisionMarkdown(report);
    expect(md).toContain('предпросмотру');expect(md).toContain('120.00');expect(md).toContain('GPU &lt;timeout&gt;');
    expect(md).toContain('320×180');expect(md).toContain('1920×1080');expect(md).toContain('```json');
    expect(md).toContain('Генераторы double-single: switch, structured.');
    expect(precisionMarkdown({results:[]} as unknown as BenchmarkReport)).toBe('');
  });
});
