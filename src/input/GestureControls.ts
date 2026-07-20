import Phaser from "phaser";

export interface GestureHandlers {
  /** Single-pointer tap (touch) or click (mouse) at a world position. */
  onTap(worldX: number, worldY: number): void;
  /** Drag delta in screen pixels while panning (single pointer held). */
  panBy(dx: number, dy: number): void;
  /** Pinch zoom: multiply the camera zoom by this factor. */
  zoomBy(factor: number): void;
}

/** A press that moved less than this and was released quickly counts as a tap. */
const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_MS = 400;

/**
 * Touch-primary gesture controls: tap, one-finger drag pan, two-finger pinch
 * zoom. Mouse follows the same model (click = tap, drag = pan), so desktop
 * works through the same path; keyboard/wheel shortcuts are added separately
 * by the scene as desktop QoL.
 */
export class GestureControls {
  private readonly scene: Phaser.Scene;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly handlers: GestureHandlers;
  private tapCandidate: { x: number; y: number; time: number } | undefined;
  private pinching = false;
  private lastPinchDistance = 0;

  constructor(
    scene: Phaser.Scene,
    camera: Phaser.Cameras.Scene2D.Camera,
    handlers: GestureHandlers,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.handlers = handlers;
    // Phaser tracks one pointer by default; enable a second for pinch.
    scene.input.addPointer(1);
    scene.input.on("pointerdown", this.onPointerDown, this);
    scene.input.on("pointermove", this.onPointerMove, this);
    scene.input.on("pointerup", this.onPointerUp, this);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const { pointer1, pointer2 } = this.scene.input;
    if (pointer1.isDown && pointer2.isDown) {
      this.pinching = true;
      this.tapCandidate = undefined;
      this.lastPinchDistance = Phaser.Math.Distance.Between(
        pointer1.x,
        pointer1.y,
        pointer2.x,
        pointer2.y,
      );
    } else {
      this.tapCandidate = { x: pointer.x, y: pointer.y, time: pointer.downTime };
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const { pointer1, pointer2 } = this.scene.input;
    if (this.pinching && pointer1.isDown && pointer2.isDown) {
      const distance = Phaser.Math.Distance.Between(pointer1.x, pointer1.y, pointer2.x, pointer2.y);
      if (this.lastPinchDistance > 0) {
        this.handlers.zoomBy(distance / this.lastPinchDistance);
      }
      this.lastPinchDistance = distance;
      return;
    }
    if (!pointer.isDown) return;
    if (
      this.tapCandidate &&
      Phaser.Math.Distance.Between(this.tapCandidate.x, this.tapCandidate.y, pointer.x, pointer.y) >
        TAP_MAX_MOVE_PX
    ) {
      this.tapCandidate = undefined;
    }
    this.handlers.panBy(pointer.x - pointer.prevPosition.x, pointer.y - pointer.prevPosition.y);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const { pointer1, pointer2 } = this.scene.input;
    if (this.pinching) {
      // Pinch ends when either finger lifts; the remaining finger never
      // becomes a tap, but may resume drag-panning.
      if (!pointer1.isDown || !pointer2.isDown) {
        this.pinching = false;
        this.lastPinchDistance = 0;
      }
      return;
    }
    if (this.tapCandidate && pointer.time - this.tapCandidate.time <= TAP_MAX_MS) {
      const world = this.camera.getWorldPoint(pointer.x, pointer.y);
      this.handlers.onTap(world.x, world.y);
    }
    this.tapCandidate = undefined;
  }
}
