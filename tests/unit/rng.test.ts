import { describe, expect, test } from "bun:test";
import { mulberry32 } from "../../src/grid/rng";

describe("mulberry32", () => {
  test("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  test("produces values in [0, 1)", () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("different seeds diverge", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const same = Array.from({ length: 10 }, () => a() === b()).filter(Boolean);
    expect(same.length).toBe(0);
  });
});
