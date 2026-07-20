import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { GameScene } from "./scenes/GameScene";

/**
 * Mobile-first: the canvas always fills the viewport (Scale.RESIZE) and the
 * camera adapts to whatever space it gets, instead of letterboxing a fixed
 * desktop resolution. The initial size only matters before the first resize —
 * a portrait phone logical size.
 */
export const INITIAL_WIDTH = 390;
export const INITIAL_HEIGHT = 844;

/** Kept separate from bootstrap so tests can inspect the config without a DOM. */
export function createGameConfig(): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent: "game",
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    backgroundColor: "#0b1020",
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, GameScene],
  };
}
