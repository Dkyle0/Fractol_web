/** A startup hint, never a hardware performance classification. */
export function mobileDeviceHint() {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return nav.userAgentData?.mobile === true || (navigator.maxTouchPoints > 0 &&
    window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(hover: none)').matches);
}
