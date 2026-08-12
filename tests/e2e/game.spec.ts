import { expect, type Page, test } from "@playwright/test";

async function readCursor(page: Page): Promise<{ x: number; y: number }> {
  const cursor = await page.evaluate(() => window.__gameState?.cursor);
  if (!cursor) throw new Error("game state not available on window");
  return cursor;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__gameState?.ready === true);
});

test("game boots and renders a canvas", async ({ page }) => {
  await expect(page.locator("#game canvas")).toBeVisible();
  const state = await page.evaluate(() => window.__gameState);
  expect(state?.scene).toBe("game");
  expect(state?.mapSize).toEqual({ width: 40, height: 30 });
});

test("tap moves the cursor to the tapped tile", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch tap is the mobile control scheme");
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport");

  const before = await readCursor(page);
  // The camera starts centered on the cursor; 64px right of center at zoom 1
  // is exactly two tiles over.
  await page.touchscreen.tap(viewport.width / 2 + 64, viewport.height / 2);
  await expect.poll(() => readCursor(page).then((c) => c.x)).toBe(before.x + 2);
});

test("drag panning does not move the cursor", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch drag is the mobile control scheme");
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport");

  const before = await readCursor(page);
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  await page.touchscreen.tap(cx, cy); // sanity: tap first so drag start differs
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  // Playwright has no touch-drag helper; drive the touchscreen via CDP-level taps
  // is overkill — use mouse-style drag, which shares the same pointer path.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy - 80, { steps: 6 });
  await page.mouse.up();
  const after = await readCursor(page);
  expect(after).toEqual({ x: before.x, y: before.y });
});

test("arrow keys nudge the grid cursor", async ({ page }) => {
  const before = await readCursor(page);

  await pressKeyWithDwell(page, "ArrowRight");
  await expect.poll(() => readCursor(page).then((c) => c.x)).toBe(before.x + 1);

  await pressKeyWithDwell(page, "ArrowUp");
  await expect.poll(() => readCursor(page).then((c) => c.y)).toBe(before.y - 1);

  await pressKeyWithDwell(page, "ArrowDown");
  await expect.poll(() => readCursor(page).then((c) => c.y)).toBe(before.y);

  await pressKeyWithDwell(page, "ArrowLeft");
  await expect.poll(() => readCursor(page).then((c) => c.x)).toBe(before.x);
});

test("cursor clamps at the map edge", async ({ page }) => {
  // Read the cursor's starting position so we know how many left-nudges will
  // definitely walk past the edge (map is 40 tiles wide).
  const start = await readCursor(page);

  // Press with a delay: headless Chromium does not auto-repeat held keys, and
  // a zero-dwell press can fall entirely between two Phaser frames on loaded
  // runners. A small down-hold per press lets every JustDown edge land in a
  // frame without depending on wall-clock sleeps.
  for (let i = 0; i < start.x + 5; i++) {
    await pressKeyWithDwell(page, "ArrowLeft");
  }
  expect((await readCursor(page)).x).toBe(0);
});

/**
 * Phaser edge-consumes keys via JustDown in update(); a zero-dwell down+up
 * (Playwright's press) can land entirely between two frames on slow or fully
 * parallel runners, swallowing the press. Hold the key across at least one
 * rendered frame so at least one update() observes the down edge.
 */
async function pressKeyWithDwell(page: Page, key: string, dwellMs = 40): Promise<void> {
  await page.keyboard.down(key);
  await page.evaluate(
    (ms) => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), ms)),
    dwellMs,
  );
  await page.keyboard.up(key);
}

test("rendered frame matches the visual baseline", async ({ page }) => {
  const canvas = page.locator("#game canvas");
  await expect(canvas).toHaveScreenshot("game-boot.png", { maxDiffPixelRatio: 0.02 });
});
