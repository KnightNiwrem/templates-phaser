import Phaser from "phaser";
import { clampTile, TILE_SIZE, tileToWorld } from "../grid/coords";
import { publishState } from "../state";
import { generateTerrain } from "../world/terrain";

export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 30;
export const MAP_SEED = 1337;

const CAMERA_PAN_SPEED = 12;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

/**
 * Aerial grid view: renders the generated terrain as a tilemap, a cursor
 * tile movable with the arrow keys, WASD/drag camera panning and wheel zoom.
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

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("Keyboard input unavailable");
    this.cursorKeys = keyboard.createCursorKeys();
    this.panKeys = keyboard.addKeys("W,A,S,D") as GameScene["panKeys"];

    this.enableDragPan();
    this.enableWheelZoom();

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
    this.cursor.x = clampTile(this.cursor.x + dx, 0, MAP_WIDTH - 1);
    this.cursor.y = clampTile(this.cursor.y + dy, 0, MAP_HEIGHT - 1);
    this.cursorSprite.setPosition(tileToWorld(this.cursor.x), tileToWorld(this.cursor.y));
    publishState({ cursor: { ...this.cursor } });
  }

  private enableDragPan(): void {
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      const camera = this.cameras.main;
      camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
      camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
    });
  }

  private enableWheelZoom(): void {
    this.input.on(
      "wheel",
      (_pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
        const camera = this.cameras.main;
        const next = camera.zoom * (dy > 0 ? 0.9 : 1.1);
        camera.setZoom(Phaser.Math.Clamp(next, MIN_ZOOM, MAX_ZOOM));
      },
    );
  }
}
