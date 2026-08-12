/**
 * Typed errors for the save system. Every public SaveManager operation
 * returns a promise, so all of these arrive as promise rejections that
 * callers can catch and discriminate with `instanceof`.
 */
export class SaveError extends Error {
  // Each class sets `name` to a string literal rather than deriving it from
  // the constructor: bundlers may rename classes, and e2e tests match on
  // `error.name` across the page boundary where `instanceof` cannot reach.
  override name = "SaveError";
}

/**
 * The stored (or imported) value is not usable: unparseable JSON, a value
 * that is not a save envelope, or a current-version payload that fails
 * runtime validation. Corruption never wedges future writes — a later
 * explicit save of fresh state may replace the corrupt value.
 */
export class CorruptSaveError extends SaveError {
  override name = "CorruptSaveError";
}

/**
 * A well-formed envelope whose format version is newer than this build
 * understands, e.g. written by a newer build in another tab or restored from
 * a backup. The data is presumed valuable, so the manager refuses to load it
 * and refuses to overwrite it.
 */
export class FutureVersionError extends SaveError {
  override name = "FutureVersionError";
  readonly foundVersion: number;
  readonly currentVersion: number;

  constructor(foundVersion: number, currentVersion: number) {
    super(
      `save format version ${foundVersion} is newer than this build's version ${currentVersion}`,
    );
    this.foundVersion = foundVersion;
    this.currentVersion = currentVersion;
  }
}

/** A well-formed envelope older than the oldest registered migration. */
export class UnsupportedVersionError extends SaveError {
  override name = "UnsupportedVersionError";
  readonly foundVersion: number;
  readonly oldestSupportedVersion: number;

  constructor(foundVersion: number, oldestSupportedVersion: number) {
    super(
      `save format version ${foundVersion} is older than the oldest supported version ${oldestSupportedVersion}`,
    );
    this.foundVersion = foundVersion;
    this.oldestSupportedVersion = oldestSupportedVersion;
  }
}

/** A migration step threw, or the fully migrated payload failed validation. */
export class MigrationError extends SaveError {
  override name = "MigrationError";
  readonly fromVersion: number;

  constructor(fromVersion: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.fromVersion = fromVersion;
  }
}

/** The payload handed to save() failed the game's runtime validator. */
export class InvalidPayloadError extends SaveError {
  override name = "InvalidPayloadError";
}
