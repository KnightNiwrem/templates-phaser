import type Phaser from "phaser";

/**
 * Snapshot of game state published on `window` so that e2e tests and
 * agent-driven browser scripts can observe and drive the game from outside.
 */
export interface GameStateSnapshot {
  ready: boolean;
  scene: string;
  cursor: { x: number; y: number };
  mapSize: { width: number; height: number };
}

declare global {
  interface Window {
    __game?: Phaser.Game;
    __gameState?: GameStateSnapshot;
    /** Exposed for e2e tests & agent scripts that need to drive the save system
     *  from inside the page. Only the pure store module — browser-dependent
     *  helpers stay in ./save/storage. */
    __saveStore?: { createSaveStore: typeof import("./save/store").createSaveStore };
    __saveStorage?: {
      LocalStorageBackend: typeof import("./save/storage").LocalStorageBackend;
      persistStorage: typeof import("./save/storage").persistStorage;
    };
  }
}

export function publishGame(game: Phaser.Game): void {
  window.__game = game;
}

export function publishState(patch: Partial<GameStateSnapshot>): void {
  window.__gameState = {
    ready: false,
    scene: "",
    cursor: { x: 0, y: 0 },
    mapSize: { width: 0, height: 0 },
    ...window.__gameState,
    ...patch,
  };
}
