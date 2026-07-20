import Phaser from "phaser";
import { TILE_SIZE } from "../grid/coords";
import { publishState } from "../state";
import { Terrain, type TerrainType } from "../world/terrain";

const TILE_COLORS: Record<TerrainType, number> = {
  [Terrain.Grass]: 0x4a7c3a,
  [Terrain.Forest]: 0x2d5223,
  [Terrain.Water]: 0x2a5f8f,
};

/**
 * Generates all textures procedurally (no asset downloads — the template is
 * fully offline) and then starts the game scene.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    this.createTilesheet();
    this.createCursorTexture();
    publishState({ scene: "boot" });
    this.scene.start("game");
  }

  /** One horizontal strip of tile frames; frame index === Terrain value. */
  private createTilesheet(): void {
    const frames = [Terrain.Grass, Terrain.Forest, Terrain.Water];
    const texture = this.textures.createCanvas("tiles", TILE_SIZE * frames.length, TILE_SIZE);
    if (!texture) throw new Error("Failed to create tilesheet texture");
    const ctx = texture.getContext();
    frames.forEach((terrain, i) => {
      const ox = i * TILE_SIZE;
      ctx.fillStyle = colorToCss(TILE_COLORS[terrain]);
      ctx.fillRect(ox, 0, TILE_SIZE, TILE_SIZE);
      // Cheap deterministic texture detail so tiles are not flat rects.
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      for (let n = 0; n < 5; n++) {
        ctx.fillRect(
          ox + ((i * 7 + n * 11) % (TILE_SIZE - 3)),
          (i * 13 + n * 5) % (TILE_SIZE - 3),
          3,
          3,
        );
      }
    });
    texture.refresh();
  }

  private createCursorTexture(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.lineStyle(2, 0xffd166, 1);
    g.strokeRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2);
    g.generateTexture("cursor", TILE_SIZE, TILE_SIZE);
    g.destroy();
  }
}

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
