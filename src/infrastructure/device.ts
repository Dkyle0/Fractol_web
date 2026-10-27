import type { DeviceInfo } from '../domain/benchmark';
type Hints = { brands?: { brand: string; version: string }[]; fullVersionList?: { brand: string; version: string }[]; platform?: string; platformVersion?: string; architecture?: string; bitness?: string; model?: string };
type ExtendedNavigator = Navigator & { deviceMemory?: number; userAgentData?: Hints & { getHighEntropyValues?: (hints: string[]) => Promise<Hints> } };
export function browserFromUA(ua: string) {
  const names = [['Edg(?:e|A|iOS)?', 'Microsoft Edge'], ['Firefox|FxiOS', 'Firefox'], ['Chrome|CriOS', 'Chrome'], ['Version', 'Safari']] as const;
  for (const [pattern, name] of names) { const match = ua.match(new RegExp(`(?:${pattern})/([\\d.]+)`)); if (match) return `${name} ${match[1]}`; }
  return 'Браузер не определён';
}
export async function collectDeviceInfo(webgl: DeviceInfo['webgl']): Promise<DeviceInfo> {
  const nav = navigator as ExtendedNavigator;
  let hints: Hints | undefined = nav.userAgentData;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (nav.userAgentData?.getHighEntropyValues) hints = { ...hints, ...await Promise.race([nav.userAgentData.getHighEntropyValues(['fullVersionList', 'platformVersion', 'architecture', 'bitness', 'model']), new Promise<Hints>(resolve => { timeout = setTimeout(() => resolve({}), 1500); })]) };
  } catch { /* Browser policy may withhold hints. The UA fallback stays available. */ }
  finally { clearTimeout(timeout); }
  const brands = hints?.fullVersionList || hints?.brands;
  const brand = brands?.find(b => /Microsoft Edge|Google Chrome|Opera|Brave/.test(b.brand)) || brands?.find(b => b.brand === 'Chromium');
  return { browser: brand ? `${brand.brand} ${brand.version}` : browserFromUA(nav.userAgent), userAgent: nav.userAgent, platform: hints?.platform ? `${hints.platform} ${hints.platformVersion || ''}`.trim() : nav.platform || 'Не определена', architecture: hints?.architecture ? `${hints.architecture} ${hints.bitness || ''}`.trim() : null, model: hints?.model || null, logicalProcessors: nav.hardwareConcurrency || null, memoryGiB: nav.deviceMemory || null, screen: { width: screen.width, height: screen.height }, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 }, webgl };
}
