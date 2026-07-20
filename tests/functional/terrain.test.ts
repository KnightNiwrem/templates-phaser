import { describe, expect, test } from "bun:test";
import { generateTerrain, Terrain } from "../../src/world/terrain";

describe("generateTerrain", () => {
  test("produces a grid of the requested size with valid tiles", () => {
    const grid = generateTerrain(40, 30, 1337);
    expect(grid.width).toBe(40);
    expect(grid.height).toBe(30);
    const valid = new Set<number>([Terrain.Grass, Terrain.Forest, Terrain.Water]);
    grid.forEach((value) => {
      expect(valid.has(value)).toBe(true);
    });
  });

  test("is deterministic for a given seed", () => {
    expect(generateTerrain(20, 20, 7).toRows()).toEqual(generateTerrain(20, 20, 7).toRows());
  });

  test("different seeds produce different maps", () => {
    expect(generateTerrain(20, 20, 1).toRows()).not.toEqual(generateTerrain(20, 20, 2).toRows());
  });

  test("contains a mix of terrain, with grass dominant", () => {
    const grid = generateTerrain(60, 60, 1337);
    const total = 60 * 60;
    const grass = grid.count((v) => v === Terrain.Grass);
    const water = grid.count((v) => v === Terrain.Water);
    expect(grass).toBeGreaterThan(total / 2);
    expect(water).toBeGreaterThan(0);
    expect(water).toBeLessThan(total / 2);
  });

  test("smoothing makes terrain blobby: isolated cells are rare", () => {
    // Simultaneous-update smoothing can leave or create a few isolated cells,
    // so assert a bound instead of zero.
    const grid = generateTerrain(60, 60, 99);
    let interior = 0;
    let isolated = 0;
    grid.forEach((value, x, y) => {
      let neighbours = 0;
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = grid.get(x + dx, y + dy);
          if (n === undefined) continue;
          neighbours++;
          if (n === value) same++;
        }
      }
      if (neighbours === 8) {
        interior++;
        if (same === 0) isolated++;
      }
    });
    expect(isolated / interior).toBeLessThan(0.02);
  });
});
