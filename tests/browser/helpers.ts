import { expect, type Page } from '@playwright/test';

/** Deterministic fallback capabilities: mobile emulation flags do not set these
 * consistently in every engine. This exercises detection, not physical hardware. */
export async function emulateTouchCapabilities(page: Page, touch: boolean) {
  await page.addInitScript(touch => {
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touch ? 5 : 0 });
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = nativeMatchMedia(query);
      const matches = query === '(pointer: coarse)' || query === '(hover: none)' ? touch
        : query === '(pointer: fine)' || query === '(hover: hover)' ? !touch : undefined;
      if (matches !== undefined) Object.defineProperty(result, 'matches', { configurable: true, value: matches });
      return result;
    };
  }, touch);
}

export async function historyAction(page: Page, name = 'Отменить действие') {
  // Vuetify deliberately ignores reopening for 50ms after close. Wait for the
  // exit transition rather than clicking its activator during the old overlay.
  await expect(page.getByRole('menu', { name: 'Ещё', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
