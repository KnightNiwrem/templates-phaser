import { describe, expect, test } from "bun:test";
import { Grid } from "../../src/grid/Grid";

describe("Grid", () => {
  test("rejects non-positive or fractional dimensions", () => {
    expect(() => new Grid(0, 5, 0)).toThrow(RangeError);
    expect(() => new Grid(5, -1, 0)).toThrow(RangeError);
    expect(() => new Grid(2.5, 2, 0)).toThrow(RangeError);
  });

  test("fills with a constant value", () => {
    const grid = new Grid(3, 2, 7);
    expect(grid.count((v) => v === 7)).toBe(6);
  });

  test("fills with a function of coordinates", () => {
    const grid = new Grid(3, 2, (x, y) => x + y * 10);
    expect(grid.get(0, 0)).toBe(0);
    expect(grid.get(2, 1)).toBe(12);
  });

  test("get returns undefined out of bounds, set is a no-op", () => {
    const grid = new Grid(2, 2, 0);
    expect(grid.get(-1, 0)).toBeUndefined();
    expect(grid.get(0, 2)).toBeUndefined();
    expect(grid.set(2, 0, 9)).toBe(false);
    expect(grid.set(1, 1, 9)).toBe(true);
    expect(grid.get(1, 1)).toBe(9);
  });

  test("toRows returns y-major rows", () => {
    const grid = new Grid(2, 2, (x, y) => x + y * 10);
    expect(grid.toRows()).toEqual([
      [0, 1],
      [10, 11],
    ]);
  });
});
