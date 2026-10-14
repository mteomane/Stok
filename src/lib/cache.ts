/**
 * Lightweight in-memory TTL cache for reducing redundant Firestore reads
 * across components and tab switches.
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();

  get<T>(key: string, ttlMs: number = 60000): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ttlMs) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.store.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  invalidate(keyPattern: string | RegExp): void {
    if (typeof keyPattern === "string") {
      this.store.delete(keyPattern);
      // Also delete any prefix match
      for (const k of this.store.keys()) {
        if (k.startsWith(keyPattern)) {
          this.store.delete(k);
        }
      }
    } else {
      for (const k of this.store.keys()) {
        if (keyPattern.test(k)) {
          this.store.delete(k);
        }
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export const memoryCache = new MemoryCache();
