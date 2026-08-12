import { LocalStorageBackend } from "./backend";
import type { PersistenceStatus } from "./durability";
import { requestPersistentStorage } from "./durability";
import type { GameSaveData } from "./gameSave";
import { createGameSaveManager, GAME_SAVE_KEY, GAME_SAVE_VERSION } from "./gameSave";
import type { SaveManager } from "./SaveManager";

/**
 * Narrow save API published on `window` so e2e tests and agent-driven browser
 * scripts can drive and inspect persistence, mirroring `window.__gameState`.
 */
export interface SaveTestHooks {
  manager: SaveManager<GameSaveData>;
  key: string;
  version: number;
  /** Result of the startup persistence request; set asynchronously after boot. */
  persistence?: PersistenceStatus;
}

declare global {
  interface Window {
    __save?: SaveTestHooks;
  }
}

/**
 * The game's save manager, composed over real localStorage. Swapping the
 * local persistence backend happens here, not throughout game code.
 */
export const gameSaveManager = createGameSaveManager(new LocalStorageBackend());

/** Publish test hooks and kick off the best-effort persistence request. */
export function initSaveSystem(): void {
  window.__save = {
    manager: gameSaveManager,
    key: GAME_SAVE_KEY,
    version: GAME_SAVE_VERSION,
  };
  // requestPersistentStorage never rejects; a denied request is a normal
  // answer and must not affect startup.
  void requestPersistentStorage().then((status) => {
    if (window.__save) window.__save.persistence = status;
  });
}
