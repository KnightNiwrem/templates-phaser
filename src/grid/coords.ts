/** Size in pixels of one grid tile. */
export const TILE_SIZE = 32;

/** World-space center of a tile coordinate (for placing sprites on a tile). */
export function tileToWorld(tile: number): number {
  return tile * TILE_SIZE + TILE_SIZE / 2;
}

/** Tile coordinate containing a world-space position. */
export function worldToTile(world: number): number {
  return Math.floor(world / TILE_SIZE);
}

/** Clamp a tile coordinate into the inclusive [min, max] range. */
export function clampTile(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
