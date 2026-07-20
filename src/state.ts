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
