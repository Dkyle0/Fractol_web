import { describe, expect, it } from 'vitest';
import { advanceQuality, createQualityState, nextRenderScale } from '../../src/domain/quality';
describe('resolution quality under vsync', () => {
  it('raises quality on a 60Hz screen with spare GPU budget', () => { expect(nextRenderScale(.65, 16.7, 4)).toBeGreaterThan(.65); });
  it('keeps compositing headroom when GPU time is already high', () => { expect(nextRenderScale(.8, 16.7, 14)).toBe(.8); });
  it('backs off when the overall frame or GPU budget is exceeded', () => { expect(nextRenderScale(.8, 30, 12)).toBeLessThan(.8); expect(nextRenderScale(.8, 16.7, 20)).toBeLessThan(.8); });
  it('adapts without requiring the optional GPU timer', () => { expect(nextRenderScale(.65, 16.7, null)).toBeGreaterThan(.65); expect(nextRenderScale(.65, 33, null)).toBeLessThan(.65); });
  it('never crosses its quality limits', () => { expect(nextRenderScale(1, 8, 2)).toBe(1); expect(nextRenderScale(.35, 50, 30)).toBe(.35); });
  it.each(['color','precision'] as const)('excludes %s samples from preview adaptation',kind=>{
    let state=createQualityState();
    for(let i=0;i<16;i++)state=advanceQuality(state,i*17,100,100,{id:i+1,ms:100,submittedAt:i*17,width:100,height:100,kind});
    expect(state.gpu).toEqual([]);expect(state.scale).toBeGreaterThan(.65);
  });
  it('reduces preview resolution for operation latency despite inexpensive color samples and fast rAF',()=>{
    let state=createQualityState();
    for(let i=0;i<16;i++)state=advanceQuality(state,i*17,100,100,{id:i+1,ms:.1,submittedAt:i*17,width:100,height:100,kind:'color'},40);
    expect(state.frameMs).toBeLessThan(18);expect(state.scale).toBeLessThan(.65);
  });
});
