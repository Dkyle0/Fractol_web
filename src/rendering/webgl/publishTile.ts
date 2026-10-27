import type { FieldTile } from '../../domain/fieldTiles';

/** Publishing to the visible field owns its presentation. Offscreen clients may
 * instead only restore their existing visible surface before yielding. */
export function publishFieldTile(context: { publishTile?(tile: FieldTile): void; present?(): void }, tile: FieldTile) {
  if (context.publishTile) context.publishTile(tile);
  else context.present?.();
}
