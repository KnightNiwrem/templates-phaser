import { expect, type Page, test } from "@playwright/test";

function requireSaveModules(page: Page) {
  return page.evaluate(() => {
    const store = window.__saveStore;
    const storage = window.__saveStorage;
    if (store == null || storage == null) {
      throw new Error("save modules not exposed on window");
    }
    return true;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__gameState?.ready === true);
});

test("save store round-trips through real localStorage", async ({ page }) => {
  expect(await requireSaveModules(page)).toBe(true);
  const result = await page.evaluate(async () => {
    const store = window.__saveStore;
    const storage = window.__saveStorage;
    if (store == null || storage == null) throw new Error("save modules missing");
    const gameStore = store.createSaveStore<{ count: number }>({
      backend: new storage.LocalStorageBackend("e2e-save-key"),
      version: 1,
      makeDefault: () => ({ count: 0 }),
      migrations: [],
    });
    await gameStore.clear();
    await gameStore.save({ count: 7 });
    const loaded = await gameStore.load();
    const exported = await gameStore.exportData();
    const before = window.localStorage.getItem("e2e-save-key");
    await gameStore.clear();
    const afterClear = await gameStore.load();
    // Restore the saved envelope — other tests should find behaviour back at pre-test shape.
    if (before != null) window.localStorage.setItem("e2e-save-key", before);
    return { loaded, exported, afterClear };
  });
  expect(result.loaded).toEqual({ count: 7 });
  expect(typeof result.exported).toBe("string");
  expect(result.exported).toContain('"count":7');
  expect(result.afterClear).toBeNull();
});

test("migrations run on load inside a browser", async ({ page }) => {
  expect(await requireSaveModules(page)).toBe(true);
  const worked = await page.evaluate(async () => {
    const store = window.__saveStore;
    const storage = window.__saveStorage;
    if (store == null || storage == null) throw new Error("save modules missing");
    window.localStorage.setItem(
      "e2e-migrate-key",
      JSON.stringify({
        version: 1,
        savedAt: 1,
        updatedAt: 1,
        payload: { name: "Ada", coins: 5 },
      }),
    );
    interface V1 {
      name: string;
      coins: number;
    }
    interface V2 {
      name: string;
      coins: number;
      level: number;
    }
    const gameStore = store.createSaveStore<V2>({
      backend: new storage.LocalStorageBackend("e2e-migrate-key"),
      version: 2,
      makeDefault: () => ({ name: "new", coins: 0, level: 1 }),
      migrations: [
        {
          from: 1,
          apply: (raw) => ({ ...(raw as V1), level: 2 }),
        },
      ],
    });
    const loaded = await gameStore.load();
    await gameStore.clear();
    return loaded;
  });
  expect(worked).toEqual({ name: "Ada", coins: 5, level: 2 });
});

test("persistStorage is callable and returns a boolean", async ({ page }) => {
  expect(await requireSaveModules(page)).toBe(true);
  const result = await page.evaluate(async () => {
    const storage = window.__saveStorage;
    if (storage == null) throw new Error("save storage module missing");
    return storage.persistStorage();
  });
  expect(typeof result).toBe("boolean");
});
