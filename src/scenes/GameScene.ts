import Phaser from "phaser";
import { clampTile, TILE_SIZE, tileToWorld, worldToTile } from "../grid/coords";
import { GestureControls } from "../input/GestureControls";
import { publishState } from "../state";
import { generateTerrain } from "../world/terrain";

export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 30;
export const MAP_SEED = 1337;

const CAMERA_PAN_SPEED = 12;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;

/**
 * Aerial grid view, mobile-first: tap a tile to move the cursor there,
 * one-finger drag pans, two-finger pinch zooms. Desktop QoL on top: arrow
 * keys nudge the cursor, WASD pans, mouse wheel zooms, click acts as tap.
 */
export class GameScene extends Phaser.Scene {
  private cursor = { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) };
  private cursorSprite!: Phaser.GameObjects.Image;
  private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
  private panKeys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super("game");
  }

  create(): void {
    const terrain = generateTerrain(MAP_WIDTH, MAP_HEIGHT, MAP_SEED);
    const map = this.make.tilemap({
      data: terrain.toRows(),
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tiles = map.addTilesetImage("tiles");
    if (!tiles) throw new Error("Tilesheet not found — did BootScene run?");
    map.createLayer(0, tiles, 0, 0);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);

    this.cursorSprite = this.add
      .image(tileToWorld(this.cursor.x), tileToWorld(this.cursor.y), "cursor")
      .setDepth(10);
    camera.centerOn(this.cursorSprite.x, this.cursorSprite.y);

    new GestureControls(this, camera, {
      onTap: (worldX, worldY) => this.moveCursorTo(worldToTile(worldX), worldToTile(worldY)),
      panBy: (dx, dy) => {
        camera.scrollX -= dx / camera.zoom;
        camera.scrollY -= dy / camera.zoom;
      },
      zoomBy: (factor) => this.zoomBy(factor),
    });
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) =>
      this.zoomBy(dy > 0 ? 0.9 : 1.1),
    );
    // Rotating the phone or resizing the window can make the current zoom
    // show beyond the map edge; re-clamp when the viewport changes.
    this.scale.on("resize", () => this.zoomBy(1));
    this.zoomBy(1);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("Keyboard input unavailable");
    this.cursorKeys = keyboard.createCursorKeys();
    this.panKeys = keyboard.addKeys("W,A,S,D") as GameScene["panKeys"];

    publishState({
      scene: "game",
      ready: true,
      cursor: { ...this.cursor },
      mapSize: { width: MAP_WIDTH, height: MAP_HEIGHT },
    });
  }

  override update(): void {
    if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.left)) this.moveCursor(-1, 0);
    if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.right)) this.moveCursor(1, 0);
    if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.up)) this.moveCursor(0, -1);
    if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.down)) this.moveCursor(0, 1);

    const camera = this.cameras.main;
    const pan = CAMERA_PAN_SPEED / camera.zoom;
    if (this.panKeys.A.isDown) camera.scrollX -= pan;
    if (this.panKeys.D.isDown) camera.scrollX += pan;
    if (this.panKeys.W.isDown) camera.scrollY -= pan;
    if (this.panKeys.S.isDown) camera.scrollY += pan;
  }

  private moveCursor(dx: number, dy: number): void {
    this.moveCursorTo(this.cursor.x + dx, this.cursor.y + dy);
  }

  private moveCursorTo(x: number, y: number): void {
    this.cursor.x = clampTile(x, 0, MAP_WIDTH - 1);
    this.cursor.y = clampTile(y, 0, MAP_HEIGHT - 1);
    this.cursorSprite.setPosition(tileToWorld(this.cursor.x), tileToWorld(this.cursor.y));
    publishState({ cursor: { ...this.cursor } });
  }

  private zoomBy(factor: number): void {
    const camera = this.cameras.main;
    camera.setZoom(Phaser.Math.Clamp(camera.zoom * factor, this.minZoom(), MAX_ZOOM));
  }

  /** Never zoom out far enough to show empty space beyond the map edges. */
  private minZoom(): number {
    const camera = this.cameras.main;
    return Math.max(
      MIN_ZOOM,
      camera.width / (MAP_WIDTH * TILE_SIZE),
      camera.height / (MAP_HEIGHT * TILE_SIZE),
    );
  }
}
