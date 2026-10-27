import type {FractalId} from '../domain/types';
/** Execution variants are internal: never serialized into scenes or preferences. */
export const kernelVariants = ['reference','reciprocal','fast','radix4','blocks','combined','estimate','reciprocal-estimate'] as const;
export type KernelVariant = typeof kernelVariants[number];
// A candidate is promoted only after the paired hardware acceptance gate.
export const RELEASE_KERNEL:KernelVariant = 'reference';
/** Per-definition promotion prevents an optimisation of rational formulas from
 * slowing unrelated escape-time formulas. Filled only by acceptance evidence. */
export const RELEASE_KERNELS:Readonly<Partial<Record<FractalId,KernelVariant>>> = Object.freeze({
  nova:'reciprocal',
  newton:'reciprocal',
});
export function releaseKernelFor(id:FractalId):KernelVariant{return RELEASE_KERNELS[id]??RELEASE_KERNEL;}
export function kernelFeatures(variant:KernelVariant) {
  return {
    reciprocal:variant==='reciprocal'||variant==='combined'||variant==='reciprocal-estimate',
    estimatedDivision:variant==='estimate'||variant==='reciprocal-estimate',
    fast:variant==='fast'||variant==='radix4'||variant==='combined',
    radix4:variant==='radix4'||variant==='combined',
    // Repeated ALU calls in fused square/norm branches can cause pathological
    // native compilation. Keep them isolated until their own acceptance gate.
    blocks:variant==='blocks',
  };
}
export function kernelId(variant:KernelVariant){return `binary64-u32-v2:${variant}`;}
