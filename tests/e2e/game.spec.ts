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
