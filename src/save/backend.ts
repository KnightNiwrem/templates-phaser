/**
 * Minimal async raw-value storage interface. The SaveManager delegates only
 * raw read/write/delete here, so swapping localStorage for another local
 * backend (e.g. IndexedDB) is a change in application composition, not in
 * game code. Implementations may throw synchronously inside their async
 * methods; callers always observe failures as promise rejections.
 */
export interface StorageBackend {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** In-memory backend for unit tests and non-browser contexts. Pure logic. */
export class MemoryStorageBackend implements StorageBackend {
  private readonly values = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async write(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

/**
 * Browser localStorage backend. Synchronous DOM failures (quota exceeded,
 * storage denied in private sessions) become promise rejections because the
 * methods are async.
 *
 * The HTML standard defines no locking between localStorage users in
 * separate agent clusters, so another tab can interleave between a
 * manager's pre-write inspection and its write. The manager's version checks
 * stop ordinary downgrade overwrites; they are not an atomic cross-tab
 * guarantee. Absolute multi-tab compare-and-write protection needs a
 * transactional backend (e.g. IndexedDB) or another coordination design.
 */
export class LocalStorageBackend implements StorageBackend {
  async read(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async write(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
}
