import type { StorageBackend } from "./backend";
import {
  CorruptSaveError,
  FutureVersionError,
  InvalidPayloadError,
  MigrationError,
  UnsupportedVersionError,
} from "./errors";

/**
 * Stored wrapper around the game payload. `formatVersion` drives migration
 * and downgrade protection. Timestamps are metadata for display/debugging,
 * not a concurrency guarantee — if conflict detection is ever needed, add an
 * explicit revision instead of comparing wall-clock time.
 */
export interface SaveEnvelope<P = unknown> {
  formatVersion: number;
  createdAt: number;
  updatedAt: number;
  payload: P;
}

/** One upgrade step: transforms a `fromVersion` payload into `fromVersion + 1`. */
export interface Migration {
  fromVersion: number;
  migrate: (payload: unknown) => unknown;
}

export interface SaveManagerOptions<T> {
  backend: StorageBackend;
  /** Raw storage key handed to the backend. */
  key: string;
  /** Current save format version; a positive integer. */
  currentVersion: number;
  /** Runtime validator for a current-version payload. TypeScript types are not trusted at the storage boundary. */
  validatePayload: (value: unknown) => value is T;
  /** Upgrade steps. Must form a contiguous chain ending at `currentVersion - 1`. */
  migrations?: readonly Migration[];
  /** Injected clock for deterministic timestamp tests. Defaults to Date.now. */
  now?: () => number;
}

function isEnvelope(value: unknown): value is SaveEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  // Timestamps must be finite: JSON.parse turns an oversized literal like
  // 1e400 into Infinity, which JSON.stringify would then store as null,
  // corrupting the envelope on its next write.
  return (
    typeof record.formatVersion === "number" &&
    Number.isInteger(record.formatVersion) &&
    record.formatVersion >= 1 &&
    typeof record.createdAt === "number" &&
    Number.isFinite(record.createdAt) &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt) &&
    "payload" in record
  );
}

/**
 * Versioned, validated persistence for a single save slot. Pure logic over an
 * injected StorageBackend — no browser APIs — so all behavior is unit-testable.
 *
 * - Saves are wrapped in a versioned envelope and runtime-validated.
 * - Old formats upgrade through registered migrations; an incomplete chain is
 *   rejected at construction. Stored data is only replaced after migration
 *   and validation succeed.
 * - A recognized newer-format save is never loaded or overwritten
 *   (FutureVersionError); corruption is reported (CorruptSaveError) but a
 *   later explicit save may replace it.
 * - Operations are applied in request order through an internal queue, so
 *   unawaited saves cannot finish out of order. A rejected operation rejects
 *   its own promise without poisoning the queue.
 */
export class SaveManager<T> {
  private readonly backend: StorageBackend;
  private readonly key: string;
  private readonly currentVersion: number;
  private readonly validatePayload: (value: unknown) => value is T;
  private readonly migrations: ReadonlyMap<number, Migration["migrate"]>;
  private readonly oldestSupportedVersion: number;
  private readonly now: () => number;
  /** Set once a newer-format stored save is observed; blocks overwrites until deleteSave(). */
  private observedNewerVersion: number | undefined;
  /** Serializes operations so the last requested save wins. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: SaveManagerOptions<T>) {
    const { currentVersion, migrations = [] } = options;
    if (!Number.isInteger(currentVersion) || currentVersion < 1) {
      throw new RangeError(`currentVersion must be a positive integer, got ${currentVersion}`);
    }
    const byVersion = new Map<number, Migration["migrate"]>();
    for (const step of migrations) {
      if (
        !Number.isInteger(step.fromVersion) ||
        step.fromVersion < 1 ||
        step.fromVersion >= currentVersion
      ) {
        throw new RangeError(
          `migration fromVersion ${step.fromVersion} must be an integer in [1, ${currentVersion - 1}]`,
        );
      }
      if (byVersion.has(step.fromVersion)) {
        throw new RangeError(`duplicate migration from version ${step.fromVersion}`);
      }
      byVersion.set(step.fromVersion, step.migrate);
    }
    // Reject a broken chain now, at startup, rather than on a player's save
    // after release: every version from the oldest registered step up to the
    // current version must be reachable.
    const oldest =
      migrations.length > 0
        ? Math.min(...migrations.map((step) => step.fromVersion))
        : currentVersion;
    for (let version = oldest; version < currentVersion; version++) {
      if (!byVersion.has(version)) {
        throw new RangeError(`missing migration from version ${version} to ${version + 1}`);
      }
    }

    this.backend = options.backend;
    this.key = options.key;
    this.currentVersion = currentVersion;
    this.validatePayload = options.validatePayload;
    this.migrations = byVersion;
    this.oldestSupportedVersion = oldest;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Load and validate the stored save, or null when none exists. A supported
   * old format is migrated in memory, validated, and only then written back
   * in the current format (preserving `createdAt`).
   */
  load(): Promise<T | null> {
    return this.enqueue(() => this.performLoad());
  }

  /**
   * Persist a payload in the current format. Preserves `createdAt` from a
   * readable existing envelope. Refuses to overwrite a recognized
   * newer-format save, even one whose payload is invalid; a corrupt stored
   * value is replaceable.
   */
  save(payload: T): Promise<void> {
    return this.enqueue(() => this.performSave(payload));
  }

  /**
   * The complete stored envelope as a JSON string for the player to keep as
   * a backup, or null when no save exists. Returns the stored bytes verbatim
   * — export never migrates, so it cannot lose information, and a
   * newer-format save can still be backed up. Anything else must prove
   * usable first (parse, migrate, and validate in memory), so a corrupt
   * value is never presented as a successful backup.
   */
  exportSave(): Promise<string | null> {
    return this.enqueue(() => this.performExport());
  }

  /**
   * Parse, validate, and migrate a candidate export entirely in memory, then
   * store it in the current format. A failed or newer-format import leaves
   * the existing save untouched.
   */
  importSave(serialized: string): Promise<T> {
    return this.enqueue(() => this.performImport(serialized));
  }

  /**
   * Remove the stored save. A deliberate delete also clears the
   * newer-format overwrite guard: nothing newer remains to protect.
   */
  deleteSave(): Promise<void> {
    return this.enqueue(() => this.performDelete());
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.queue.then(operation, operation);
    // Absorb the rejection on the queue copy only; `result` still rejects
    // for its caller, and later operations run regardless.
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async performLoad(): Promise<T | null> {
    const raw = await this.backend.read(this.key);
    if (raw === null) return null;
    const envelope = this.parseEnvelope(raw, "stored");
    const { payload, migrated } = this.upgradePayload(envelope);
    if (migrated) {
      await this.writeEnvelope(payload, envelope.createdAt);
    }
    return payload;
  }

  private async performSave(payload: T): Promise<void> {
    if (!this.validatePayload(payload)) {
      throw new InvalidPayloadError("save payload failed runtime validation");
    }
    const existingCreatedAt = await this.guardOverwrite();
    await this.writeEnvelope(payload, existingCreatedAt ?? this.now());
  }

  private async performExport(): Promise<string | null> {
    const raw = await this.backend.read(this.key);
    if (raw === null) return null;
    let envelope: SaveEnvelope;
    try {
      envelope = this.parseEnvelope(raw, "stored");
    } catch (error) {
      // Exporting a newer save is allowed (it is a backup, and backups must
      // not be blocked by build age); observing it has already armed the
      // overwrite guard inside parseEnvelope. Anything else unparseable or
      // unsupported is not a usable backup.
      if (error instanceof FutureVersionError) return raw;
      throw error;
    }
    // Prove the stored bytes are usable before presenting them as a backup.
    // The migration/validation runs in memory only; the stored envelope is
    // returned verbatim so no information is lost.
    this.upgradePayload(envelope);
    return raw;
  }

  private async performImport(serialized: string): Promise<T> {
    // Everything below is validated in memory before any write, so a failed
    // import cannot disturb the existing save.
    const envelope = this.parseEnvelope(serialized, "import");
    const { payload } = this.upgradePayload(envelope);
    await this.guardOverwrite();
    // The candidate's createdAt is the save's own history; keep it.
    await this.writeEnvelope(payload, envelope.createdAt);
    return payload;
  }

  private async performDelete(): Promise<void> {
    await this.backend.remove(this.key);
    this.observedNewerVersion = undefined;
  }

  /**
   * Parse a raw string into a recognized envelope. A newer-format envelope in
   * *stored* data arms the overwrite guard; an import candidate does not,
   * because it says nothing about what is currently stored.
   */
  private parseEnvelope(raw: string, source: "stored" | "import"): SaveEnvelope {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (cause) {
      throw new CorruptSaveError(`${source} save is not valid JSON`, { cause });
    }
    if (!isEnvelope(value)) {
      throw new CorruptSaveError(`${source} value is not a save envelope`);
    }
    if (value.formatVersion > this.currentVersion) {
      if (source === "stored") this.observedNewerVersion = value.formatVersion;
      throw new FutureVersionError(value.formatVersion, this.currentVersion);
    }
    if (value.formatVersion < this.oldestSupportedVersion) {
      throw new UnsupportedVersionError(value.formatVersion, this.oldestSupportedVersion);
    }
    return value;
  }

  /** Run the migration chain in memory, then runtime-validate the result. */
  private upgradePayload(envelope: SaveEnvelope): { payload: T; migrated: boolean } {
    let payload: unknown = envelope.payload;
    for (let version = envelope.formatVersion; version < this.currentVersion; version++) {
      const migrate = this.migrations.get(version);
      if (!migrate) {
        // Unreachable: the constructor rejects incomplete chains and
        // parseEnvelope rejects versions below the oldest supported.
        throw new MigrationError(version, `missing migration from version ${version}`);
      }
      try {
        payload = migrate(payload);
      } catch (cause) {
        throw new MigrationError(version, `migration from version ${version} failed`, { cause });
      }
    }
    if (!this.validatePayload(payload)) {
      throw envelope.formatVersion < this.currentVersion
        ? new MigrationError(envelope.formatVersion, "migrated payload failed runtime validation")
        : new CorruptSaveError("stored payload failed runtime validation");
    }
    return { payload, migrated: envelope.formatVersion < this.currentVersion };
  }

  /**
   * Inspect the existing stored value before replacing it. Throws for a
   * recognized newer-format envelope — even one with an invalid payload —
   * and remembers it so later writes stay blocked. Corrupt values are
   * replaceable. Returns the existing envelope's createdAt when readable.
   */
  private async guardOverwrite(): Promise<number | undefined> {
    if (this.observedNewerVersion !== undefined) {
      throw new FutureVersionError(this.observedNewerVersion, this.currentVersion);
    }
    const raw = await this.backend.read(this.key);
    if (raw === null) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!isEnvelope(value)) return undefined;
    if (value.formatVersion > this.currentVersion) {
      this.observedNewerVersion = value.formatVersion;
      throw new FutureVersionError(value.formatVersion, this.currentVersion);
    }
    return value.createdAt;
  }

  private async writeEnvelope(payload: T, createdAt: number): Promise<void> {
    const envelope: SaveEnvelope<T> = {
      formatVersion: this.currentVersion,
      createdAt,
      updatedAt: this.now(),
      payload,
    };
    // JSON.stringify throws on cyclic or BigInt payloads; inside this async
    // method that surfaces as a promise rejection the caller can catch.
    await this.backend.write(this.key, JSON.stringify(envelope));
  }
}
