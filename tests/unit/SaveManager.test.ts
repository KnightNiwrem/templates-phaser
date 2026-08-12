import { describe, expect, test } from "bun:test";
import { MemoryStorageBackend, type StorageBackend } from "../../src/save/backend";
import {
  CorruptSaveError,
  FutureVersionError,
  InvalidPayloadError,
  MigrationError,
  UnsupportedVersionError,
} from "../../src/save/errors";
import type { Migration, SaveEnvelope } from "../../src/save/SaveManager";
import { SaveManager } from "../../src/save/SaveManager";

interface TestSave {
  hero: string;
}

function isTestSave(value: unknown): value is TestSave {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).hero === "string"
  );
}

const KEY = "test.save";

function createManager(options?: {
  backend?: StorageBackend;
  currentVersion?: number;
  migrations?: readonly Migration[];
  now?: () => number;
  validatePayload?: (value: unknown) => value is TestSave;
}) {
  const backend = options?.backend ?? new MemoryStorageBackend();
  const manager = new SaveManager<TestSave>({
    backend,
    key: KEY,
    currentVersion: options?.currentVersion ?? 1,
    validatePayload: options?.validatePayload ?? isTestSave,
    migrations: options?.migrations,
    now: options?.now,
  });
  return { backend, manager };
}

function envelopeJson(formatVersion: number, payload: unknown, createdAt = 1000, updatedAt = 2000) {
  return JSON.stringify({ formatVersion, createdAt, updatedAt, payload });
}

async function storedEnvelope(backend: StorageBackend): Promise<SaveEnvelope> {
  const raw = await backend.read(KEY);
  if (raw === null) throw new Error("nothing stored");
  return JSON.parse(raw) as SaveEnvelope;
}

describe("SaveManager basics", () => {
  test("load returns null when nothing is saved", async () => {
    const { manager } = createManager();
    expect(await manager.load()).toBeNull();
  });

  test("save/load round-trip", async () => {
    const { manager } = createManager();
    await manager.save({ hero: "ada" });
    expect(await manager.load()).toEqual({ hero: "ada" });
  });

  test("stored value is a versioned envelope", async () => {
    const { backend, manager } = createManager({ now: () => 42 });
    await manager.save({ hero: "ada" });
    expect(await storedEnvelope(backend)).toEqual({
      formatVersion: 1,
      createdAt: 42,
      updatedAt: 42,
      payload: { hero: "ada" },
    });
  });

  test("save preserves createdAt and refreshes updatedAt", async () => {
    let time = 100;
    const { backend, manager } = createManager({ now: () => time });
    await manager.save({ hero: "ada" });
    time = 200;
    await manager.save({ hero: "grace" });
    const envelope = await storedEnvelope(backend);
    expect(envelope.createdAt).toBe(100);
    expect(envelope.updatedAt).toBe(200);
  });

  test("save rejects a payload that fails runtime validation", async () => {
    const { backend, manager } = createManager();
    await expect(manager.save({ hero: 7 } as unknown as TestSave)).rejects.toBeInstanceOf(
      InvalidPayloadError,
    );
    expect(await backend.read(KEY)).toBeNull();
  });

  test("delete removes the save", async () => {
    const { manager } = createManager();
    await manager.save({ hero: "ada" });
    await manager.deleteSave();
    expect(await manager.load()).toBeNull();
  });
});

describe("SaveManager runtime validation and corruption", () => {
  test("unparseable JSON is reported as corruption", async () => {
    const { backend, manager } = createManager();
    await backend.write(KEY, "definitely {not json");
    await expect(manager.load()).rejects.toBeInstanceOf(CorruptSaveError);
  });

  test("valid JSON that is not an envelope is corruption", async () => {
    const { backend, manager } = createManager();
    await backend.write(KEY, JSON.stringify({ hero: "ada" }));
    await expect(manager.load()).rejects.toBeInstanceOf(CorruptSaveError);
  });

  test("a current-version envelope with an invalid payload is corruption", async () => {
    const { backend, manager } = createManager();
    await backend.write(KEY, envelopeJson(1, { hero: 7 }));
    await expect(manager.load()).rejects.toBeInstanceOf(CorruptSaveError);
  });

  test("a later explicit save replaces a corrupt value instead of failing forever", async () => {
    const { backend, manager } = createManager();
    await backend.write(KEY, "garbage");
    await expect(manager.load()).rejects.toBeInstanceOf(CorruptSaveError);
    await manager.save({ hero: "ada" });
    expect(await manager.load()).toEqual({ hero: "ada" });
  });
});

describe("SaveManager migrations", () => {
  const v1ToV2: Migration = {
    fromVersion: 1,
    migrate: (payload) => ({ hero: String((payload as { name: unknown }).name) }),
  };

  test("a single-step migration upgrades and persists the save", async () => {
    const { backend, manager } = createManager({
      currentVersion: 2,
      migrations: [v1ToV2],
      now: () => 5000,
    });
    await backend.write(KEY, envelopeJson(1, { name: "ada" }, 1000, 2000));
    expect(await manager.load()).toEqual({ hero: "ada" });
    const envelope = await storedEnvelope(backend);
    expect(envelope.formatVersion).toBe(2);
    expect(envelope.createdAt).toBe(1000);
    expect(envelope.updatedAt).toBe(5000);
  });

  test("chained migrations run in order", async () => {
    const { backend, manager } = createManager({
      currentVersion: 3,
      migrations: [
        { fromVersion: 2, migrate: (payload) => ({ hero: `sir ${(payload as TestSave).hero}` }) },
        v1ToV2,
      ],
    });
    await backend.write(KEY, envelopeJson(1, { name: "ada" }));
    expect(await manager.load()).toEqual({ hero: "sir ada" });
    expect((await storedEnvelope(backend)).formatVersion).toBe(3);
  });

  test("construction rejects a migration chain with a gap", () => {
    expect(() => createManager({ currentVersion: 3, migrations: [v1ToV2] })).toThrow(RangeError);
  });

  test("construction rejects duplicate and out-of-range migration steps", () => {
    expect(() => createManager({ currentVersion: 2, migrations: [v1ToV2, v1ToV2] })).toThrow(
      RangeError,
    );
    expect(() => createManager({ currentVersion: 1, migrations: [v1ToV2] })).toThrow(RangeError);
  });

  test("a failing migration leaves the stored save untouched", async () => {
    const { backend, manager } = createManager({
      currentVersion: 2,
      migrations: [
        {
          fromVersion: 1,
          migrate: () => {
            throw new Error("boom");
          },
        },
      ],
    });
    const original = envelopeJson(1, { name: "ada" });
    await backend.write(KEY, original);
    await expect(manager.load()).rejects.toBeInstanceOf(MigrationError);
    expect(await backend.read(KEY)).toBe(original);
  });

  test("a migration producing an invalid payload leaves the stored save untouched", async () => {
    const { backend, manager } = createManager({
      currentVersion: 2,
      migrations: [{ fromVersion: 1, migrate: () => ({ wrong: true }) }],
    });
    const original = envelopeJson(1, { name: "ada" });
    await backend.write(KEY, original);
    await expect(manager.load()).rejects.toBeInstanceOf(MigrationError);
    expect(await backend.read(KEY)).toBe(original);
  });

  test("a version older than the oldest migration is unsupported, not corrupt", async () => {
    const { backend, manager } = createManager({
      currentVersion: 3,
      migrations: [{ fromVersion: 2, migrate: (payload) => payload }],
    });
    await backend.write(KEY, envelopeJson(1, { name: "ada" }));
    await expect(manager.load()).rejects.toBeInstanceOf(UnsupportedVersionError);
  });
});

describe("SaveManager future-version protection", () => {
  test("loading a newer-format save fails with a typed error", async () => {
    const { backend, manager } = createManager();
    await backend.write(KEY, envelopeJson(99, { hero: "ada" }));
    await expect(manager.load()).rejects.toBeInstanceOf(FutureVersionError);
  });

  test("a newer-format save is never overwritten once observed", async () => {
    const { backend, manager } = createManager();
    const newer = envelopeJson(99, { hero: "ada" });
    await backend.write(KEY, newer);
    await expect(manager.load()).rejects.toBeInstanceOf(FutureVersionError);
    await expect(manager.save({ hero: "grace" })).rejects.toBeInstanceOf(FutureVersionError);
    expect(await backend.read(KEY)).toBe(newer);
  });

  test("save inspects the stored value even without a prior load", async () => {
    const { backend, manager } = createManager();
    const newer = envelopeJson(99, { hero: "ada" });
    await backend.write(KEY, newer);
    await expect(manager.save({ hero: "grace" })).rejects.toBeInstanceOf(FutureVersionError);
    expect(await backend.read(KEY)).toBe(newer);
  });

  test("a newer-format envelope with an invalid payload still blocks overwrite", async () => {
    const { backend, manager } = createManager();
    const newer = envelopeJson(99, { utterly: ["unknown", "shape"] });
    await backend.write(KEY, newer);
    await expect(manager.save({ hero: "grace" })).rejects.toBeInstanceOf(FutureVersionError);
    expect(await backend.read(KEY)).toBe(newer);
  });

  test("future-version data is distinct from corruption", async () => {
    const { backend, manager } = createManager();
    await backend.write(KEY, envelopeJson(99, {}));
    await expect(manager.load()).rejects.toBeInstanceOf(FutureVersionError);
    await backend.write(KEY, "garbage");
    const fresh = createManager({ backend }).manager;
    await expect(fresh.load()).rejects.toBeInstanceOf(CorruptSaveError);
  });

  test("an explicit delete clears the overwrite guard", async () => {
    const { backend, manager } = createManager();
    await backend.write(KEY, envelopeJson(99, {}));
    await expect(manager.load()).rejects.toBeInstanceOf(FutureVersionError);
    await manager.deleteSave();
    await manager.save({ hero: "ada" });
    expect(await manager.load()).toEqual({ hero: "ada" });
  });
});

describe("SaveManager export/import", () => {
  test("export returns the complete stored envelope verbatim", async () => {
    const { backend, manager } = createManager();
    await manager.save({ hero: "ada" });
    expect(await manager.exportSave()).toBe(await backend.read(KEY));
  });

  test("export returns null when nothing is saved and rejects corruption", async () => {
    const { backend, manager } = createManager();
    expect(await manager.exportSave()).toBeNull();
    await backend.write(KEY, "garbage");
    await expect(manager.exportSave()).rejects.toBeInstanceOf(CorruptSaveError);
  });

  test("import round-trips an export", async () => {
    const { manager } = createManager();
    await manager.save({ hero: "ada" });
    const exported = await manager.exportSave();
    if (exported === null) throw new Error("expected an export");
    await manager.deleteSave();
    expect(await manager.importSave(exported)).toEqual({ hero: "ada" });
    expect(await manager.load()).toEqual({ hero: "ada" });
  });

  test("an invalid import leaves the existing save untouched", async () => {
    const { backend, manager } = createManager();
    await manager.save({ hero: "ada" });
    const before = await backend.read(KEY);
    await expect(manager.importSave("garbage")).rejects.toBeInstanceOf(CorruptSaveError);
    await expect(manager.importSave(envelopeJson(1, { hero: 7 }))).rejects.toBeInstanceOf(
      CorruptSaveError,
    );
    expect(await backend.read(KEY)).toBe(before);
  });

  test("a future-version import is refused and leaves the existing save untouched", async () => {
    const { backend, manager } = createManager();
    await manager.save({ hero: "ada" });
    const before = await backend.read(KEY);
    await expect(manager.importSave(envelopeJson(99, { hero: "grace" }))).rejects.toBeInstanceOf(
      FutureVersionError,
    );
    expect(await backend.read(KEY)).toBe(before);
    // The candidate said nothing about the stored save: writes are not blocked.
    await manager.save({ hero: "grace" });
    expect(await manager.load()).toEqual({ hero: "grace" });
  });

  test("an imported old-format save is migrated and stored at the current version", async () => {
    const { backend, manager } = createManager({
      currentVersion: 2,
      migrations: [
        {
          fromVersion: 1,
          migrate: (payload) => ({ hero: String((payload as { name: unknown }).name) }),
        },
      ],
      now: () => 9000,
    });
    expect(await manager.importSave(envelopeJson(1, { name: "ada" }, 1234))).toEqual({
      hero: "ada",
    });
    const envelope = await storedEnvelope(backend);
    expect(envelope.formatVersion).toBe(2);
    expect(envelope.createdAt).toBe(1234);
    expect(envelope.updatedAt).toBe(9000);
    expect(envelope.payload).toEqual({ hero: "ada" });
  });
});

describe("SaveManager ordering and failure handling", () => {
  test("unawaited saves are applied in request order and the last one wins", async () => {
    const writes: string[] = [];
    let delayFirstWrite = true;
    const inner = new MemoryStorageBackend();
    const backend: StorageBackend = {
      read: (key) => inner.read(key),
      remove: (key) => inner.remove(key),
      write: async (key, value) => {
        if (delayFirstWrite) {
          delayFirstWrite = false;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        writes.push((JSON.parse(value) as SaveEnvelope<TestSave>).payload.hero);
        await inner.write(key, value);
      },
    };
    const { manager } = createManager({ backend });
    const all = [
      manager.save({ hero: "first" }),
      manager.save({ hero: "second" }),
      manager.save({ hero: "third" }),
    ];
    await Promise.all(all);
    expect(writes).toEqual(["first", "second", "third"]);
    expect(await manager.load()).toEqual({ hero: "third" });
  });

  test("a rejected write does not poison the queue", async () => {
    let failNext = true;
    const inner = new MemoryStorageBackend();
    const backend: StorageBackend = {
      read: (key) => inner.read(key),
      remove: (key) => inner.remove(key),
      write: async (key, value) => {
        if (failNext) {
          failNext = false;
          throw new Error("transient write failure");
        }
        await inner.write(key, value);
      },
    };
    const { manager } = createManager({ backend });
    const first = manager.save({ hero: "first" });
    const second = manager.save({ hero: "second" });
    await expect(first).rejects.toThrow("transient write failure");
    await second;
    expect(await manager.load()).toEqual({ hero: "second" });
  });

  test("a synchronously throwing backend surfaces as a rejected promise", async () => {
    const quota = new Error("QuotaExceededError: storage full");
    const backend: StorageBackend = {
      read: async () => null,
      remove: async () => undefined,
      write: (): Promise<void> => {
        throw quota;
      },
    };
    const { manager } = createManager({ backend });
    await expect(manager.save({ hero: "ada" })).rejects.toBe(quota);
  });

  test("a cyclic payload rejects instead of throwing synchronously", async () => {
    const { backend, manager } = createManager();
    const cyclic: TestSave & { self?: unknown } = { hero: "ada" };
    cyclic.self = cyclic;
    await expect(manager.save(cyclic)).rejects.toBeInstanceOf(TypeError);
    expect(await backend.read(KEY)).toBeNull();
  });

  test("a payload JSON cannot represent rejects instead of throwing", async () => {
    const { manager } = createManager({
      // Permissive validator so the failure comes from serialization.
      validatePayload: (value): value is TestSave => typeof value === "object" && value !== null,
    });
    await expect(
      manager.save({ hero: "ada", coins: 1n } as unknown as TestSave),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
