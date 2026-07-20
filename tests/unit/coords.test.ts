import { describe, expect, test } from "bun:test";
import { clampTile, TILE_SIZE, tileToWorld, worldToTile } from "../../src/grid/coords";

describe("coords", () => {
  test("tileToWorld returns the tile center", () => {
    expect(tileToWorld(0)).toBe(TILE_SIZE / 2);
    expect(tileToWorld(3)).toBe(3 * TILE_SIZE + TILE_SIZE / 2);
  });

  test("worldToTile and tileToWorld round-trip", () => {
    for (const tile of [0, 1, 5, 39]) {
      expect(worldToTile(tileToWorld(tile))).toBe(tile);
    }
  });

  test("worldToTile floors within the tile", () => {
    expect(worldToTile(TILE_SIZE - 1)).toBe(0);
    expect(worldToTile(TILE_SIZE)).toBe(1);
  });

  test("clampTile clamps into range", () => {
    expect(clampTile(-3, 0, 9)).toBe(0);
    expect(clampTile(12, 0, 9)).toBe(9);
    expect(clampTile(5, 0, 9)).toBe(5);
  });
});
