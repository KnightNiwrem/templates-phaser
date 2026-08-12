export interface PersistenceStatus {
  /** Whether the StorageManager persistence API exists in this browser. */
  supported: boolean;
  /** Whether the origin's storage is persisted. Best-effort: false is a normal answer, not an error. */
  persisted: boolean;
}

type PersistenceApi = Pick<StorageManager, "persist" | "persisted">;

/**
 * Best-effort request for persistent storage. No browser storage is
 * permanent: users can clear it, private sessions discard it, and WebKit
 * documents deleting script-writable storage after seven days of Safari use
 * without user interaction with the site (Home Screen web apps are exempt).
 * Asking for persistence and offering export/import backups are the useful
 * mitigations; a denied or rejected request must not break startup, so this
 * never throws.
 *
 * The storage manager is injectable for deterministic tests; it defaults to
 * `navigator.storage` when present.
 */
export async function requestPersistentStorage(
  storage: PersistenceApi | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.storage,
): Promise<PersistenceStatus> {
  if (
    !storage ||
    typeof storage.persisted !== "function" ||
    typeof storage.persist !== "function"
  ) {
    return { supported: false, persisted: false };
  }
  try {
    if (await storage.persisted()) return { supported: true, persisted: true };
    return { supported: true, persisted: await storage.persist() };
  } catch {
    // A rejected persistence query is an ordinary browser answer.
    return { supported: true, persisted: false };
  }
}
