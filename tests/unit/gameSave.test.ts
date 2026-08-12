import { describe, expect, test } from "bun:test";
import { MemoryStorageBackend } from "../../src/save/backend";
import { MigrationError } from "../../src/save/errors";
import {
  createGameSaveManager,
  GAME_SAVE_KEY,
  GAME_SAVE_VERSION,
  isGameSaveData,
} from "../../src/save/gameSave";
import type { SaveEnvelope } from "../../src/save/SaveManager";

describe("isGameSaveData", () => {
  test("accepts a non-negative integer cursor", () => {
    expect(isGameSaveData({ cursor: { x: 0, y: 0 } })).toBe(true);
    expect(isGameSaveData({ cursor: { x: 12, y: 7 } })).toBe(true);
  });

  test("rejects foreign shapes and non-integer coordinates", () => {
    expect(isGameSaveData(null)).toBe(false);
    expect(isGameSaveData("save")).toBe(false);
    expect(isGameSaveData({})).toBe(false);
    expect(isGameSaveData({ cursor: null })).toBe(false);
    expect(isGameSaveData({ cursor: { x: 1.5, y: 0 } })).toBe(false);
    expect(isGameSaveData({ cursor: { x: -1, y: 0 } })).toBe(false);
    expect(isGameSaveData({ cursor: { x: "1", y: 0 } })).toBe(false);
  });

  test("rejects arrays even with expando properties", () => {
    // JSON.stringify drops expando properties on arrays, so these would
    // serialize into saves that can never be read back.
    expect(isGameSaveData(Object.assign([], { cursor: { x: 1, y: 1 } }))).toBe(false);
    expect(isGameSaveData({ cursor: Object.assign([], { x: 1, y: 1 }) })).toBe(false);
  });
});

describe("game save migrations", () => {
  test("a version 1 save upgrades to the current format", async () => {
    const backend = new MemoryStorageBackend();
    await backend.write(
      GAME_SAVE_KEY,
      JSON.stringify({
        formatVersion: 1,
        createdAt: 1000,
        updatedAt: 2000,
        payload: { cursorX: 3, cursorY: 4 },
      }),
    );
    const manager = createGameSaveManager(backend, () => 5000);
    expect(await manager.load()).toEqual({ cursor: { x: 3, y: 4 } });
    const raw = await backend.read(GAME_SAVE_KEY);
    if (raw === null) throw new Error("nothing stored");
    const envelope = JSON.parse(raw) as SaveEnvelope;
    expect(envelope.formatVersion).toBe(GAME_SAVE_VERSION);
    expect(envelope.createdAt).toBe(1000);
    expect(envelope.payload).toEqual({ cursor: { x: 3, y: 4 } });
  });

  test("a version 1 save without cursor fields fails as a migration error", async () => {
    const backend = new MemoryStorageBackend();
    const original = JSON.stringify({
      formatVersion: 1,
      createdAt: 1000,
      updatedAt: 2000,
      payload: { something: "else" },
    });
    await backend.write(GAME_SAVE_KEY, original);
    const manager = createGameSaveManager(backend);
    await expect(manager.load()).rejects.toBeInstanceOf(MigrationError);
    expect(await backend.read(GAME_SAVE_KEY)).toBe(original);
  });
});
