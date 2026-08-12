/**
 * Versioned save persistence behind a storage adapter.
 *
 * Games register MIGRATIONS (ordered transforms between versions) and a
 * makeDefault() factory; the store owns envelope creation, stamping,
 * validation, and migrations on load. Backends only need to implement
 * {@link SaveBackend}'s five small methods, so swapping localStorage for
 * IndexedDB is a constructor-arg change, not a rewrite.
 *
 * Platform reality (all three lines matter):
 * - iOS Safari can evict website data for non-installed sites ~7 days after
 *   the last interaction.
 * - Mitigations: install as PWA, call navigator.storage.persist() early, and
 *   keep export/import profiles available.
 * - Call the `persistStorage` helper (see `./storage`) early in app boot;
 *   do NOT silently promise durability.
 *
 * This module is game-agnostic: persistence layer only. Keep it pure (no
 * DOM / window imports) so `bun:test` can run it without a browser; the
 * small set of window/localStorage helpers lives in `./storage` and is
 * covered from e2e.
 */

/** Opaque serialized envelope (backend treats this as a string or Uint8Array). */
export type StoragePayload = string;

/**
 * Redacts timestamp fields on save (off by default). Deterministic envelope
 * content makes export diffs stable and keeps tests snapshot-friendly,
 * at the cost of losing savedAt/updatedAt.
 */
export interface SaveStoreOptions {
  redactTimestamps?: boolean;
}

/**
 * The portable contract every backend implements.
 *
 * - `exportBlob` / `importBlob` take the ENVELOPE (serialized), because the
 *   envelope (version + payload + timestamps) is the unit of migration and
 *   interchange — raw bytes would lose save-format history.
 * - Async by contract so IndexedDB (or OPFS, or a sync service) drops in without
 *   callers changing shape; localStorage's implementation is sync-wrapped.
 */
export interface SaveBackend {
  /** Read raw stored envelope, or null when absent. */
  load(): Promise<StoragePayload | null>;
  /** Overwrite current stored envelope. */
  save(payload: StoragePayload): Promise<void>;
  /** Serialize current envelope bytes (same as `load`, but guaranteed to throw on empty). */
  exportBlob(): Promise<StoragePayload>;
  /** Persist an envelope previously obtained via {@link exportBlob}. */
  importBlob(payload: StoragePayload): Promise<void>;
  /** Remove stored envelope (new-game + test isolation). */
  clear(): Promise<void>;
}

/** Envelope format — internal between SaveStore & backends. */
interface SaveEnvelope<TPayload> {
  version: number;
  /** Unix ms; -1 when redactTimestamps: true. */
  savedAt: number;
  /** Unix ms; -1 when redactTimestamps: true. */
  updatedAt: number;
  payload: TPayload;
}

/**
 * One migration step. `from` must be exactly one less than the next version in
 * the chain (chained strictly: v1→v2→v3 … no skipping).
 */
export interface Migration<TBefore = unknown, TAfter = unknown> {
  from: number;
  apply(input: TBefore): TAfter;
}

/** Runtime collaborator interface — what games see. */
export interface SaveStore<TPayload> {
  readonly CURRENT_VERSION: number;
  /** The payload factory supplied at construction; callers may use it for new games. */
  readonly makeDefault: () => TPayload;
  load(): Promise<TPayload | null>;
  save(payload: TPayload): Promise<void>;
  exportData(): Promise<StoragePayload>;
  importData(data: StoragePayload): Promise<TPayload>;
  clear(): Promise<void>;
}

/**
 * Creates a save store bound to a specific game payload type:
 * - `version` — the CURRENT schema version. Migrations must cover every step
 *   from 1 up to (but excluding) this number.
 * - `makeDefault` — payload factory used when no save exists (returns fresh
 *   v-current default state).
 * - `migrations` — array of single-step transforms; each `apply` moves payload
 *   from `migration.from` to `migration.from + 1`.
 */
export function createSaveStore<TPayload>(opts: {
  backend: SaveBackend;
  version: number;
  makeDefault: () => TPayload;
  migrations: Array<Migration>;
  options?: SaveStoreOptions;
}): SaveStore<TPayload> {
  const { backend, version, makeDefault, migrations, options } = opts;
  const redactTimestamps = options?.redactTimestamps ?? false;

  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid CURRENT_VERSION: ${version}`);
  }
  // Migrations must form a strict chain ending at (version-1)→version.
  const sorted = [...migrations].sort((a, b) => a.from - b.from);
  for (let i = 0; i < sorted.length; i++) {
    const expectedFrom = i + 1;
    const step = sorted[i];
    if (step == null || step.from !== expectedFrom) {
      throw new Error(`Migrations must chain 1→2… without gaps; expected from=${expectedFrom}`);
    }
  }
  if (sorted.length !== version - 1) {
    throw new Error(`Migrations count must equal version-1 (${version - 1}), got ${sorted.length}`);
  }

  function stamp(savedAt: number, updatedAt: number): { savedAt: number; updatedAt: number } {
    if (redactTimestamps) return { savedAt: -1, updatedAt: -1 };
    return { savedAt, updatedAt };
  }

  function serialize(envelope: SaveEnvelope<TPayload>): StoragePayload {
    return JSON.stringify(envelope);
  }

  function deserialize(raw: StoragePayload): SaveEnvelope<unknown> {
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new Error("Saved data is not valid JSON");
    }
    if (envelope == null || typeof envelope !== "object") {
      throw new Error("Saved data is not an envelope object");
    }
    const rec = envelope as Record<string, unknown>;
    if (typeof rec.version !== "number" || !Number.isInteger(rec.version)) {
      throw new Error("Saved data missing integer version");
    }
    if (rec.version < 1) {
      throw new Error(`Saved data version ${rec.version} is not supported`);
    }
    if (!("payload" in rec)) {
      throw new Error("Saved data missing payload");
    }
    return envelope as SaveEnvelope<unknown>;
  }

  function migrate(envelope: SaveEnvelope<unknown>): TPayload {
    if (envelope.version > version) {
      throw new Error(
        `Save version ${envelope.version} is newer than CURRENT_VERSION ${version} — refusing to load`,
      );
    }
    let payload = envelope.payload;
    for (let v = envelope.version; v < version; v++) {
      const step = sorted[v - 1];
      if (!step) {
        throw new Error(`Missing migration step ${v}→${v + 1}`);
      }
      payload = step.apply(payload);
    }
    return payload as TPayload;
  }

  // Serialize all mutating store operations through one promise chain so
  // overlapping calls cannot interleave their read-modify-write cycles
  // (last requested write wins).
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<TOp>(op: () => Promise<TOp>): Promise<TOp> {
    const result = queue.then(() => op());
    queue = result.catch(() => {});
    return result;
  }

  return {
    CURRENT_VERSION: version,
    makeDefault,

    async load(): Promise<TPayload | null> {
      const raw = await backend.load();
      if (raw == null) return null;
      return migrate(deserialize(raw));
    },

    async save(payload: TPayload): Promise<void> {
      return enqueue(async () => {
        const raw = await backend.load();
        let previous: SaveEnvelope<unknown> | null = null;
        if (raw != null) {
          try {
            previous = deserialize(raw);
          } catch {
            // Corrupt or foreign stored value: treat as absent so save() can
            // recover gracefully with a fresh envelope instead of rejecting.
            previous = null;
          }
        }
        if (previous != null && previous.version > version) {
          throw new Error(
            `Cannot save: stored version ${previous.version} is newer than CURRENT_VERSION ${version} — refusing to overwrite`,
          );
        }
        const now = Date.now();
        const stamped = stamp(
          previous != null && typeof previous.savedAt === "number" ? previous.savedAt : now,
          now,
        );
        const envelope: SaveEnvelope<TPayload> = {
          version,
          savedAt: stamped.savedAt,
          updatedAt: stamped.updatedAt,
          payload,
        };
        await backend.save(serialize(envelope));
      });
    },

    async exportData(): Promise<StoragePayload> {
      return backend.exportBlob();
    },

    async importData(data: StoragePayload): Promise<TPayload> {
      return enqueue(async () => {
        const envelope = deserialize(data);
        const migrated = migrate(envelope);
        const now = Date.now();
        // Persist the migrated envelope at the current version so later load()
        // calls skip migration and stay consistent with the returned payload.
        const stamped = stamp(typeof envelope.savedAt === "number" ? envelope.savedAt : now, now);
        await backend.importBlob(
          serialize({
            version,
            savedAt: stamped.savedAt,
            updatedAt: stamped.updatedAt,
            payload: migrated,
          }),
        );
        return migrated;
      });
    },

    async clear(): Promise<void> {
      return enqueue(() => backend.clear());
    },
  };
}
