import { describe, expect, it, vi, afterEach } from 'vitest';
import { advanceQuality, createQualityState, qualityProfiles, type GpuMeasurement, type QualityState } from '../../src/domain/quality';
import { readPreferences, writePreferences } from '../../src/infrastructure/preferences';
const sample = (id: number, submittedAt: number, ms = 30): GpuMeasurement => ({ id, submittedAt, ms, width: 800, height: 600 });
function frames(state: QualityState, count: number, interval = 20, gpu: GpuMeasurement | null = null) {
  let now = state.lastFrame ?? 0;
  if (state.lastFrame == null) state = advanceQuality(state, now, 800, 600, null);
  for (let i = 0; i < count; i++) { now += interval; state = advanceQuality(state, now, 800, 600, gpu); }
  return state;
}
describe('profile transitions and GPU freshness', () => {
  it.each(['auto', 'performance', 'quality'] as const)('bounds %s and keeps snapshots independent', profile => {
    const initial = createQualityState(profile);
    expect(initial.scale).toBe(qualityProfiles[profile].initial);
    const loaded = frames(initial, 180, 34);
    expect(loaded.scale).toBe(qualityProfiles[profile].min);
    const recovered = frames(loaded, 400, 8);
    expect(recovered.scale).toBe(qualityProfiles[profile].max);
    expect(initial.gpu).toEqual([]); expect(initial.lastFrame).toBeNull();
    if (profile === 'quality') expect(loaded.glassReduced).toBe(false);
  });
  it('requires twelve samples and a 200ms decision interval', () => {
    let s = frames(createQualityState(), 12, 8);
    expect(s.scale).toBe(.65);
    s = frames(s, 14, 8); expect(s.scale).toBe(.7);
    s = frames(s, 12, 8); expect(s.scale).toBe(.7);
  });
  it('uses one fresh GPU id once, then falls back to rAF', () => {
    let s = frames(createQualityState(), 12, 20, sample(1, 20));
    expect(s.scale).toBe(.55);
    s = frames(s, 30, 8, sample(1, 20)); expect(s.scale).toBe(.6);
  });
  it.each([
    { ...sample(1, -1000) }, { ...sample(1, 20), width: 400 }, { ...sample(1, 20), height: 300 },
    { ...sample(1, 20), ms: NaN }, { ...sample(1, 20), ms: -1 }, sample(1, 1000),
  ])('rejects stale, mismatched and invalid GPU input %#', gpu => {
    const s = frames(createQualityState(), 26, 8, gpu);
    expect(s.scale).toBe(.7);
  });
  it('uses median new GPU samples and expires gathered samples before deciding', () => {
    let s = advanceQuality(createQualityState(), 0, 800, 600, null);
    for (let i = 1; i <= 26; i++) s = advanceQuality(s, i * 8, 800, 600, sample(i, i * 8, i === 13 ? 100 : 1));
    expect(s.scale).toBe(.7);
    s = advanceQuality(createQualityState(), 0, 800, 600, sample(1, 0));
    s = frames(s, 12, 30); expect(s.scale).toBe(.55); // cadence, not the expired GPU sample
    expect(s.gpu).toEqual([]);
  });
  it('requires 600 continuous ms at minimum scale and cancels interrupted overload', () => {
    let s = { ...createQualityState(), scale: .35 };
    s = frames(s, 17, 34); expect(s.glassReduced).toBe(false);
    s = frames(s, 2, 34); expect(s.glassReduced).toBe(true);
    const healthy = frames({ ...createQualityState(), scale: .35 }, 60, 8);
    expect(healthy.overloadedSince).toBeNull(); expect(healthy.glassReduced).toBe(false);
    const paused = frames(frames({ ...createQualityState(), scale: .35 }, 17, 34), 60, 8);
    const resumed = frames({ ...paused, scale: .35 }, 17, 34);
    expect(resumed.glassReduced).toBe(false);
  });
  it('accepts high-refresh cadence and bounds the GPU window', () => {
    let s = createQualityState();
    for (let i = 0; i < 2000; i++) s = advanceQuality(s, i * 1000 / 360, 800, 600, sample(i + 1, i * 1000 / 360, 1));
    expect(s.scale).toBe(1); expect(s.gpu.length).toBeLessThan(100);
  });
  it.each([2, 3])('keeps Auto responsive in a synthetic %sx GPU-cost model', multiplier => {
    let s = advanceQuality(createQualityState(), 0, 800, 600, null), now = 0;
    for (let i = 1; i < 600; i++) {
      const gpuMs = 6 * multiplier * s.scale ** 2;
      now += Math.max(1000 / 60, gpuMs + 4);
      s = advanceQuality(s, now, 800, 600, sample(i, now, gpuMs));
    }
    expect(s.frameMs).toBeLessThan(20); expect(s.scale).toBeGreaterThan(.35);
    expect(s.glassReduced).toBe(false);
  });
});
describe('compatible profile preferences', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([undefined, 'performance', 'quality', 'broken'])('reads %s without losing old appearance', qualityProfile => {
    let raw = JSON.stringify({ version: 1, lightGlass: true, diagnostics: true, qualityProfile });
    vi.stubGlobal('localStorage', { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; } });
    const result = readPreferences();
    expect(result.preferences).toMatchObject({ lightGlass: true, diagnostics: true, qualityProfile: qualityProfile === 'quality' || qualityProfile === 'performance' ? qualityProfile : 'auto' });
    expect(Boolean(result.warning)).toBe(qualityProfile === 'broken');
    expect(writePreferences(result.preferences)).toBe(true); expect(readPreferences()).toEqual({ preferences: result.preferences, warning: '' });
  });
});
