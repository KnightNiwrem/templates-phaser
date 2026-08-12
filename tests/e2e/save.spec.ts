import { expect, type Page, test } from "@playwright/test";
import { GAME_SAVE_KEY, GAME_SAVE_VERSION } from "../../src/save/gameSave";

const SAVE_KEY = GAME_SAVE_KEY;
const CURRENT_VERSION = GAME_SAVE_VERSION;

async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gameState?.ready === true);
}

async function readRawSave(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
}

/** Seed raw localStorage, then reboot the game so it loads the seeded value. */
async function rebootWithRawSave(page: Page, raw: string): Promise<void> {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, raw] as const);
  await page.reload();
  await waitForReady(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);
});

test("a save round-trips through real localStorage across reloads", async ({ page }) => {
  await page.evaluate(() => window.__save?.manager.save({ cursor: { x: 5, y: 7 } }));
  const raw = await readRawSave(page);
  if (!raw) throw new Error("expected a stored save");
  const envelope = JSON.parse(raw);
  expect(envelope.formatVersion).toBe(CURRENT_VERSION);
  expect(envelope.payload).toEqual({ cursor: { x: 5, y: 7 } });

  await page.reload();
  await waitForReady(page);
  // The scene restores the cursor asynchronously after boot.
  await expect.poll(() => page.evaluate(() => window.__gameState?.cursor)).toEqual({ x: 5, y: 7 });
});

test("moving the cursor persists it", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard is the desktop control scheme");
  const before = await page.evaluate(() => window.__gameState?.cursor);
  if (!before) throw new Error("game state not available on window");

  // Hold the key until the game observes it (see game.spec.ts for why a
  // zero-dwell press can fall between two update() calls).
  await page.keyboard.down("ArrowRight");
  try {
    await page.waitForFunction((x) => window.__gameState?.cursor.x === x, before.x + 1);
  } finally {
    await page.keyboard.up("ArrowRight");
  }

  await expect
    .poll(async () => {
      const raw = await readRawSave(page);
      return raw ? JSON.parse(raw).payload.cursor : null;
    })
    .toEqual({ x: before.x + 1, y: before.y });
});

test("an old-format save upgrades on boot", async ({ page }) => {
  await rebootWithRawSave(
    page,
    JSON.stringify({
      formatVersion: 1,
      createdAt: 1000,
      updatedAt: 2000,
      payload: { cursorX: 3, cursorY: 4 },
    }),
  );
  await expect.poll(() => page.evaluate(() => window.__gameState?.cursor)).toEqual({ x: 3, y: 4 });
  await expect
    .poll(async () => {
      const raw = await readRawSave(page);
      return raw ? JSON.parse(raw) : null;
    })
    .toMatchObject({
      formatVersion: CURRENT_VERSION,
      createdAt: 1000,
      payload: { cursor: { x: 3, y: 4 } },
    });
});

test("a newer-format save is refused and never overwritten", async ({ page }) => {
  const newer = JSON.stringify({
    formatVersion: 99,
    createdAt: 1000,
    updatedAt: 2000,
    payload: { from: "the future" },
  });
  await rebootWithRawSave(page, newer);

  // The game boots with its default cursor instead of crashing.
  const state = await page.evaluate(() => window.__gameState);
  expect(state?.cursor).toEqual({ x: 20, y: 15 });

  const errors = await page.evaluate(async () => {
    const manager = window.__save?.manager;
    if (!manager) throw new Error("save hooks not published");
    const results: string[] = [];
    for (const operation of [
      () => manager.load(),
      () => manager.save({ cursor: { x: 1, y: 1 } }),
    ]) {
      results.push(
        await operation().then(
          () => "resolved",
          (error: Error) => error.name,
        ),
      );
    }
    return results;
  });
  expect(errors).toEqual(["FutureVersionError", "FutureVersionError"]);
  expect(await readRawSave(page)).toBe(newer);
});

test("corrupt stored data is reported but replaceable by a fresh save", async ({ page }) => {
  await rebootWithRawSave(page, "definitely {not json");

  const loadError = await page.evaluate(() =>
    window.__save?.manager.load().then(
      () => "resolved",
      (error: Error) => error.name,
    ),
  );
  expect(loadError).toBe("CorruptSaveError");

  await page.evaluate(() => window.__save?.manager.save({ cursor: { x: 2, y: 2 } }));
  const raw = await readRawSave(page);
  if (!raw) throw new Error("expected a stored save");
  expect(JSON.parse(raw)).toMatchObject({
    formatVersion: CURRENT_VERSION,
    payload: { cursor: { x: 2, y: 2 } },
  });
});

test("the persistence helper reports a status without blocking boot", async ({ page }) => {
  await expect.poll(() => page.evaluate(() => window.__save?.persistence)).toBeDefined();
  const status = await page.evaluate(() => window.__save?.persistence);
  expect(typeof status?.supported).toBe("boolean");
  expect(typeof status?.persisted).toBe("boolean");
});

test("boot survives an unavailable persistence API", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "storage", { get: () => undefined });
  });
  await page.goto("/");
  await waitForReady(page);
  await expect
    .poll(() => page.evaluate(() => window.__save?.persistence))
    .toEqual({ supported: false, persisted: false });
});

test("boot survives a rejecting persistence API", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.storage.persisted = () => Promise.reject(new Error("nope"));
  });
  await page.goto("/");
  await waitForReady(page);
  await expect
    .poll(() => page.evaluate(() => window.__save?.persistence))
    .toEqual({ supported: true, persisted: false });
});
