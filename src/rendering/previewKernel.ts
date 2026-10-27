import type {FractalId} from '../domain/types';
export type PreviewGenerator='switch'|'structured';
/** Only measured, accepted definitions may be promoted. */
const releasePreview:Readonly<Partial<Record<FractalId,PreviewGenerator>>>=Object.freeze({});
export const previewGeneratorFor=(id:FractalId):PreviewGenerator=>releasePreview[id]??'switch';
