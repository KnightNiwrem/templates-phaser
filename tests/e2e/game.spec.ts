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

test("arrow keys move the grid cursor and clamp at the map edge", async ({ page }) => {
  const before = await readCursor(page);

  await page.keyboard.press("ArrowRight");
  await expect.poll(() => readCursor(page).then((c) => c.x)).toBe(before.x + 1);

  await page.keyboard.press("ArrowUp");
  await expect.poll(() => readCursor(page).then((c) => c.y)).toBe(before.y - 1);

  // Walk left past the west edge: the cursor must clamp at x = 0.
  for (let i = 0; i < 50; i++) await page.keyboard.press("ArrowLeft");
  expect((await readCursor(page)).x).toBe(0);
});

test("rendered frame matches the visual baseline", async ({ page }) => {
  const canvas = page.locator("#game canvas");
  await expect(canvas).toHaveScreenshot("game-boot.png", { maxDiffPixelRatio: 0.02 });
});
