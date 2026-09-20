export interface CacheOptions {
  ttlMs: number;
  now?: () => number;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export class ExpiringMemoryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: CacheOptions) {
    this.ttlMs = Math.max(0, options.ttlMs);
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, value });
  }
}
