import { describe, expect, mock, test } from "bun:test";
import { createSaveStore, type SaveBackend } from "../../src/save/store";

/** In-memory SaveBackend for unit tests (no DOM needed; localStorage covered from e2e). */
class MemoryBackend implements SaveBackend {
  constructor(
    private readonly backing: Map<string, string> = new Map(),
    private readonly key: string = "template-phaser-save",
  ) {}

  load(): Promise<string | null> {
    return Promise.resolve(this.backing.get(this.key) ?? null);
  }
  save(payload: string): Promise<void> {
    this.backing.set(this.key, payload);
    return Promise.resolve();
  }
  exportBlob(): Promise<string> {
    const v = this.backing.get(this.key);
    if (v == null) throw new Error("No saved data to export");
    return Promise.resolve(v);
  }
  importBlob(payload: string): Promise<void> {
    this.backing.set(this.key, payload);
    return Promise.resolve();
  }
  clear(): Promise<void> {
    this.backing.delete(this.key);
    return Promise.resolve();
  }
  /** Raw stored envelope as a string, for tests that inspect the serialized form. */
  storedEnvelope(): string {
    const v = this.backing.get(this.key);
    if (v == null) throw new Error("No stored envelope");
    return v;
  }
}

interface V1 {
  name: string;
  coins: number;
}

interface V2 {
  name: string;
  coins: number;
  level: number;
}

interface V3 {
  name: string;
  coins: number;
  level: number;
  active: boolean;
}

describe("save/store", () => {
  describe("makeDefault + save + load round-trip (v1)", () => {
    test("load returns payload after save", async () => {
      const store = createSaveStore<V1>({
        backend: new MemoryBackend(),
        version: 1,
        makeDefault: () => ({ name: "new game", coins: 0 }),
        migrations: [],
      });
      await store.save({ name: "Ada", coins: 42 });
      expect(await store.load()).toEqual({ name: "Ada", coins: 42 });
    });

    test("save twice preserves original savedAt, bumps updatedAt", async () => {
      const backend = new MemoryBackend();
      const store = createSaveStore<V1>({
        backend,
        version: 1,
        makeDefault: () => ({ name: "new game", coins: 0 }),
        migrations: [],
        options: { redactTimestamps: false },
      });
      await store.save({ name: "one", coins: 1 });
      const first = JSON.parse(backend.storedEnvelope()) as {
        savedAt: number;
        updatedAt: number;
      };
      await new Promise((r) => setTimeout(r, 5));
      await store.save({ name: "two", coins: 2 });
      const second = JSON.parse(backend.storedEnvelope()) as {
        savedAt: number;
        updatedAt: number;
      };
      expect(second.savedAt).toBe(first.savedAt);
      expect(second.updatedAt).toBeGreaterThanOrEqual(second.savedAt);
    });

    test("redactTimestamps: true stamps -1/-1 deterministically", async () => {
      const backend = new MemoryBackend();
      const store = createSaveStore<V1>({
        backend,
        version: 1,
        makeDefault: () => ({ name: "new game", coins: 0 }),
        migrations: [],
        options: { redactTimestamps: true },
      });
      await store.save({ name: "x", coins: 1 });
      await store.save({ name: "y", coins: 2 });
      const stored = JSON.parse(backend.storedEnvelope()) as {
        savedAt: number;
        updatedAt: number;
      };
      expect(stored.savedAt).toBe(-1);
      expect(stored.updatedAt).toBe(-1);
    });
  });

  describe("load() empty slot", () => {
    test("returns null (caller falls back to makeDefault)", async () => {
      const store = createSaveStore<V1>({
        backend: new MemoryBackend(),
        version: 1,
        makeDefault: () => ({ name: "new game", coins: 0 }),
        migrations: [],
      });
      expect(await store.load()).toBeNull();
    });
  });

  describe("version migrations", () => {
    test("single-step: v1 envelope loads through store at CURRENT_VERSION 2", async () => {
      const backing = new Map<string, string>();
      // Pre-seed a v1 envelope by hand.
      backing.set(
        "template-phaser-save",
        JSON.stringify({
          version: 1,
          savedAt: 111,
          updatedAt: 111,
          payload: { name: "Ada", coins: 9 },
        }),
      );

      const store = createSaveStore<V2>({
        backend: new MemoryBackend(backing),
        version: 2,
        makeDefault: () => ({ name: "new game", coins: 0, level: 1 }),
        migrations: [
          {
            from: 1,
            apply: (v1: V1): V2 => ({ ...v1, level: 1 }),
          },
        ],
      });

      expect(await store.load()).toEqual({ name: "Ada", coins: 9, level: 1 });
    });

    test("chained: v1 envelope loads through store at CURRENT_VERSION 3", async () => {
      const backing = new Map<string, string>();
      backing.set(
        "template-phaser-save",
        JSON.stringify({
          version: 1,
          savedAt: 222,
          updatedAt: 222,
          payload: { name: "Ada", coins: 9 },
        }),
      );

      const store = createSaveStore<V3>({
        backend: new MemoryBackend(backing),
        version: 3,
        makeDefault: () => ({ name: "new game", coins: 0, level: 1, active: true }),
        migrations: [
          { from: 1, apply: (v1: V1): V2 => ({ ...v1, level: 1 }) },
          { from: 2, apply: (v2: V2): V3 => ({ ...v2, active: true }) },
        ],
      });

      expect(await store.load()).toEqual({
        name: "Ada",
        coins: 9,
        level: 1,
        active: true,
      });
    });

    test("constructor throws when migrations don't chain strictly", () => {
      expect(() =>
        createSaveStore<V2>({
          backend: new MemoryBackend(),
          version: 3,
          makeDefault: () => ({ name: "", coins: 0, level: 0 }),
          migrations: [{ from: 2, apply: (v: unknown) => v }], // skips 1→2
        }),
      ).toThrow(/chain/i);
    });

    test("constructed CURRENT_VERSION < stored version throws on load", async () => {
      const backing = new Map<string, string>();
      backing.set(
        "template-phaser-save",
        JSON.stringify({
          version: 3,
          savedAt: 1,
          updatedAt: 1,
          payload: { anything: true },
        }),
      );
      const olderStore = createSaveStore<V2>({
        backend: new MemoryBackend(backing),
        version: 2,
        makeDefault: () => ({ name: "", coins: 0, level: 0 }),
        migrations: [{ from: 1, apply: (v: unknown) => ({ ...(v as V1), level: 1 }) }],
      });
      await expect(olderStore.load()).rejects.toThrow(/newer than CURRENT_VERSION/);
    });
  });

  describe("exportBlob / importBlob", () => {
    test("export throws under empty storage", async () => {
      const store = createSaveStore<V1>({
        backend: new MemoryBackend(),
        version: 1,
        makeDefault: () => ({ name: "new", coins: 0 }),
        migrations: [],
      });
      await expect(store.exportData()).rejects.toThrow(/No saved data/);
    });

    test("round-trip: export → clear → import restores payload", async () => {
      const store = createSaveStore<V1>({
        backend: new MemoryBackend(),
        version: 1,
        makeDefault: () => ({ name: "new", coins: 0 }),
        migrations: [],
      });
      await store.save({ name: "keep me", coins: 777 });
      const blob = await store.exportData();
      await store.clear();
      expect(await store.load()).toBeNull();
      const imported = await store.importData(blob);
      expect(imported).toEqual({ name: "keep me", coins: 777 });
      expect(await store.load()).toEqual({ name: "keep me", coins: 777 });
    });

    test("importData runs migrations before returning payload", async () => {
      const store = createSaveStore<V2>({
        backend: new MemoryBackend(),
        version: 2,
        makeDefault: () => ({ name: "new", coins: 0, level: 1 }),
        migrations: [{ from: 1, apply: (v: unknown) => ({ ...(v as V1), level: 1 }) }],
      });
      const rawV1 = JSON.stringify({
        version: 1,
        savedAt: 1,
        updatedAt: 1,
        payload: { name: "Ada", coins: 5 },
      });
      const imported = await store.importData(rawV1);
      expect(imported).toEqual({ name: "Ada", coins: 5, level: 1 });
    });
  });

  describe("clear()", () => {
    test("drops the stored envelope", async () => {
      const store = createSaveStore<V1>({
        backend: new MemoryBackend(),
        version: 1,
        makeDefault: () => ({ name: "new", coins: 0 }),
        migrations: [],
      });
      await store.save({ name: "x", coins: 1 });
      await store.clear();
      expect(await store.load()).toBeNull();
    });
  });

  describe("validation traps", () => {
    test("load throws on non-JSON stored content", async () => {
      const backing = new Map<string, string>();
      backing.set("template-phaser-save", "not json at all {");
      const store = createSaveStore<V1>({
        backend: new MemoryBackend(backing),
        version: 1,
        makeDefault: () => ({ name: "new", coins: 0 }),
        migrations: [],
      });
      await expect(store.load()).rejects.toThrow(/not valid JSON/);
    });

    test("load throws on envelope missing version", async () => {
      const backing = new Map<string, string>();
      backing.set(
        "template-phaser-save",
        JSON.stringify({ savedAt: 1, updatedAt: 1, payload: {} }),
      );
      const store = createSaveStore<V1>({
        backend: new MemoryBackend(backing),
        version: 1,
        makeDefault: () => ({ name: "new", coins: 0 }),
        migrations: [],
      });
      await expect(store.load()).rejects.toThrow(/integer version/);
    });

    test("load throws on envelope missing payload", async () => {
      const backing = new Map<string, string>();
      backing.set("template-phaser-save", JSON.stringify({ version: 1, savedAt: 1, updatedAt: 1 }));
      const store = createSaveStore<V1>({
        backend: new MemoryBackend(backing),
        version: 1,
        makeDefault: () => ({ name: "new", coins: 0 }),
        migrations: [],
      });
      await expect(store.load()).rejects.toThrow(/missing payload/);
    });
  });

  test("timestamps land in UTC-ms integer form when not redacted", async () => {
    const spy = mock(() => 1_700_000_000_000);
    const originalNow = Date.now;
    Date.now = spy;
    try {
      const backend = new MemoryBackend();
      const store = createSaveStore<V1>({
        backend,
        version: 1,
        makeDefault: () => ({ name: "new", coins: 0 }),
        migrations: [],
      });
      await store.save({ name: "timed", coins: 1 });
      const stored = JSON.parse(backend.storedEnvelope()) as {
        savedAt: number;
        updatedAt: number;
      };
      expect(stored.savedAt).toBe(1_700_000_000_000);
      expect(stored.updatedAt).toBe(1_700_000_000_000);
    } finally {
      Date.now = originalNow;
    }
  });
});
