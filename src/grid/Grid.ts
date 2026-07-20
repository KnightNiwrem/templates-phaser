/**
 * A fixed-size 2D grid of cells, addressed by integer tile coordinates.
 * Pure logic only — no Phaser or DOM dependencies, so it is unit-testable
 * under `bun test`.
 */
export class Grid<T> {
  readonly width: number;
  readonly height: number;
  private readonly cells: T[];

  constructor(width: number, height: number, fill: T | ((x: number, y: number) => T)) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`Grid dimensions must be positive integers, got ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.cells = new Array<T>(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.cells[y * width + x] =
          typeof fill === "function" ? (fill as (x: number, y: number) => T)(x, y) : fill;
      }
    }
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): T | undefined {
    if (!this.inBounds(x, y)) return undefined;
    return this.cells[y * this.width + x];
  }

  /** Returns false (and changes nothing) when the target is out of bounds. */
  set(x: number, y: number, value: T): boolean {
    if (!this.inBounds(x, y)) return false;
    this.cells[y * this.width + x] = value;
    return true;
  }

  forEach(callback: (value: T, x: number, y: number) => void): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        callback(this.cells[y * this.width + x] as T, x, y);
      }
    }
  }

  count(predicate: (value: T, x: number, y: number) => boolean): number {
    let n = 0;
    this.forEach((value, x, y) => {
      if (predicate(value, x, y)) n++;
    });
    return n;
  }

  /** Cells as rows (y-major), matching Phaser's tilemap `data` shape. */
  toRows(): T[][] {
    const rows: T[][] = [];
    for (let y = 0; y < this.height; y++) {
      rows.push(this.cells.slice(y * this.width, (y + 1) * this.width));
    }
    return rows;
  }
}
