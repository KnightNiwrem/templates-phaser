import { Grid } from "../grid/Grid";
import { mulberry32 } from "../grid/rng";

/**
 * Terrain types. The numeric values double as frame indexes into the
 * generated "tiles" tilesheet (see BootScene), so keep them aligned.
 */
export const Terrain = {
  Grass: 0,
  Forest: 1,
  Water: 2,
} as const;
export type TerrainType = (typeof Terrain)[keyof typeof Terrain];

const WATER_THRESHOLD = 0.3;
const FOREST_THRESHOLD = 0.12;
const SMOOTHING_PASSES = 2;

/**
 * Generate a terrain grid with a seeded RNG, then smooth it with a
 * cellular-automata pass so water and forest form blobs instead of noise.
 * Pure logic — no Phaser dependency.
 */
export function generateTerrain(width: number, height: number, seed: number): Grid<TerrainType> {
  const rand = mulberry32(seed);
  let grid = new Grid<TerrainType>(width, height, () => {
    const roll = rand();
    if (roll < WATER_THRESHOLD) return Terrain.Water;
    if (roll < WATER_THRESHOLD + FOREST_THRESHOLD) return Terrain.Forest;
    return Terrain.Grass;
  });
  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    grid = smooth(grid);
  }
  return grid;
}

/** A cell keeps/becomes its type when at least 4 of its 8 neighbours share it. */
function smooth(grid: Grid<TerrainType>): Grid<TerrainType> {
  const next = new Grid<TerrainType>(grid.width, grid.height, Terrain.Grass);
  grid.forEach((value, x, y) => {
    next.set(x, y, majority(grid, x, y) ?? value);
  });
  return next;
}

function majority(grid: Grid<TerrainType>, x: number, y: number): TerrainType | undefined {
  const counts = new Map<TerrainType, number>();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const value = grid.get(x + dx, y + dy);
      if (value === undefined) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  let best: TerrainType | undefined;
  let bestCount = 3; // require at least 4 votes
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
