import { expect, type Page, test } from "@playwright/test";

async function readCursor(page: Page): Promise<{ x: number; y: number }> {
  const cursor = await page.evaluate(() => window.__gameState?.cursor);
  if (!cursor) throw new Error("game state not available on window");
  return cursor;
}

/**
 * Hold `key` down until the cursor's `axis` coordinate reaches `expected`,
 * then release.
 *
 * The scene reads arrow keys with Phaser's JustDown() inside update(), and
 * key-up clears the just-down flag. A zero-dwell press (Playwright's
 * keyboard.press with no delay) can deliver key-down and key-up between two
 * game updates, so the press is never observed. Holding the key until the
 * game visibly reacts makes each press deterministic; JustDown fires once per
 * down transition, so holding cannot produce extra movements.
 */
async function holdKeyUntilCursorAt(
  page: Page,
  key: string,
  axis: "x" | "y",
  expected: number,
): Promise<void> {
  await page.keyboard.down(key);
  try {
    // waitForFunction polls on requestAnimationFrame, so the movement is seen
    // within a frame of the update that applied it — expect.poll's 100ms+
    // backoff intervals make a 20-tile walk overrun the test timeout on a
    // loaded machine.
    await page.waitForFunction(([a, v]) => window.__gameState?.cursor[a] === v, [
      axis,
      expected,
    ] as const);
  } catch (cause) {
    const actual = await readCursor(page);
    throw new Error(`held ${key} but cursor.${axis} is ${actual[axis]}, expected ${expected}`, {
      cause,
    });
  } finally {
    await page.keyboard.up(key);
  }
}

/**
 * Hold `key` down across at least `steps` full game steps, then release.
 * For presses that produce no observable state change (e.g. pressing into a
 * clamped map edge), this still guarantees the scene's update() ran while the
 * key was down.
 */
async function holdKeyForSteps(page: Page, key: string, steps: number): Promise<void> {
  await page.keyboard.down(key);
  try {
    await page.evaluate(
      (count) =>
        new Promise<void>((resolve, reject) => {
          const game = window.__game;
          if (!game) {
            reject(new Error("game not published on window"));
            return;
          }
          let seen = 0;
          const onStep = (): void => {
            seen += 1;
            if (seen >= count) {
              game.events.off("poststep", onStep);
              resolve();
            }
          };
          game.events.on("poststep", onStep);
        }),
      steps,
    );
  } finally {
    await page.keyboard.up(key);
  }
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
  // ~22 observable press cycles at 2-3 input roundtrips each; headless
  // software rendering keeps the page main thread busy, so each roundtrip
  // costs ~100ms and the walk needs more than the default 30s budget.
  test.slow();

  const before = await readCursor(page);

  await holdKeyUntilCursorAt(page, "ArrowRight", "x", before.x + 1);
  await holdKeyUntilCursorAt(page, "ArrowUp", "y", before.y - 1);

  // Walk to the west edge one observable press at a time.
  for (let { x } = await readCursor(page); x > 0; x--) {
    await holdKeyUntilCursorAt(page, "ArrowLeft", "x", x - 1);
  }

  // One more press at the edge, held across full game steps so update()
  // definitely saw it: the cursor must clamp at x = 0 rather than move.
  await holdKeyForSteps(page, "ArrowLeft", 2);
  expect((await readCursor(page)).x).toBe(0);
});

test("rendered frame matches the visual baseline", async ({ page }) => {
  const canvas = page.locator("#game canvas");
  await expect(canvas).toHaveScreenshot("game-boot.png", { maxDiffPixelRatio: 0.02 });
});
