import type { StorageBackend } from "./backend";
import type { Migration } from "./SaveManager";
import { SaveManager } from "./SaveManager";

/**
 * The demo game's save schema: what the player would lose by clearing the
 * browser — currently just the cursor tile. Pure logic (no Phaser/DOM) so the
 * schema, validator, and migrations are unit-testable.
 *
 * When you replace the demo payload with your game's own state, reset
 * GAME_SAVE_VERSION to 1 and clear GAME_SAVE_MIGRATIONS; from then on, every
 * breaking payload change bumps the version and adds one migration step.
 */

export const GAME_SAVE_KEY = "template-phaser.save";
export const GAME_SAVE_VERSION = 2;

export interface GameSaveData {
  cursor: { x: number; y: number };
}

/** Runtime validation — stored bytes are never trusted through TypeScript types alone. */
export function isGameSaveData(value: unknown): value is GameSaveData {
  // Arrays are rejected explicitly: expando properties on an array pass
  // typeof/field checks but are dropped by JSON.stringify, so accepting one
  // would write a save that can never be read back.
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const cursor = (value as Record<string, unknown>).cursor;
  if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return false;
  const { x, y } = cursor as Record<string, unknown>;
  return Number.isInteger(x) && Number.isInteger(y) && (x as number) >= 0 && (y as number) >= 0;
}

/**
 * Worked example of a migration step: format version 1 stored the cursor as
 * flat `cursorX`/`cursorY` fields; version 2 nests them under `cursor`. A
 * migration must throw on unexpected input rather than guess — the manager
 * reports that as a MigrationError and leaves the stored save untouched.
 */
export const GAME_SAVE_MIGRATIONS: readonly Migration[] = [
  {
    fromVersion: 1,
    migrate: (payload) => {
      if (typeof payload === "object" && payload !== null) {
        const { cursorX, cursorY } = payload as Record<string, unknown>;
        if (typeof cursorX === "number" && typeof cursorY === "number") {
          return { cursor: { x: cursorX, y: cursorY } };
        }
      }
      throw new Error("version 1 payload has no cursorX/cursorY fields");
    },
  },
];

/** The backend is injected so tests compose this with MemoryStorageBackend. */
export function createGameSaveManager(
  backend: StorageBackend,
  now?: () => number,
): SaveManager<GameSaveData> {
  return new SaveManager<GameSaveData>({
    backend,
    key: GAME_SAVE_KEY,
    currentVersion: GAME_SAVE_VERSION,
    validatePayload: isGameSaveData,
    migrations: GAME_SAVE_MIGRATIONS,
    now,
  });
}
