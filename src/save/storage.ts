/**
 * Browser-window helpers for the save system, isolated here so that
 * `store.ts` (pure envelope/version/migration logic) stays unit-testable
 * under `bun:test` without a DOM. Do not import this file from unit tests;
 * cover it from e2e instead.
 */

/** localStorage-backed {@link SaveBackend}. Async per contract; stored value is a UTF-8 envelope string. */
export class LocalStorageBackend {
  constructor(private readonly key: string = "template-phaser-save") {}

  load(): Promise<string | null> {
    return Promise.resolve(window.localStorage.getItem(this.key));
  }

  save(payload: string): Promise<void> {
    window.localStorage.setItem(this.key, payload);
    return Promise.resolve();
  }

  exportBlob(): Promise<string> {
    const value = window.localStorage.getItem(this.key);
    if (value == null) {
      throw new Error("No saved data to export");
    }
    return Promise.resolve(value);
  }

  importBlob(payload: string): Promise<void> {
    window.localStorage.setItem(this.key, payload);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    window.localStorage.removeItem(this.key);
    return Promise.resolve();
  }
}

/**
 * Ask the browser to make this origin's storage persistent (less likely to
 * be evicted under pressure). Returns true when persistence was granted;
 * false when denied or unsupported. Safe to call repeatedly — and it should
 * be called EARLY in app boot, per the storage-eviction ruling (iOS Safari
 * can evict uninstalled website data ~7 days after last interaction). The
 * durable fallback stays PWA install + export/import profiles, so do NOT
 * treat a `true` return as a guarantee.
 */
export async function persistStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.storage == null) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
