// backend/services/svcfacilitator/src/cache/MirrorStore.v2.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0037 — Unified Route Policies (Edge + S2S)
 * - ADR-0038 — Authorization Hierarchy and Enforcement
 *
 * Purpose:
 * - Brand-new, in-memory, TTL-based cache for per-service mirror snapshots.
 * - Keys are "<slug>@<version>" (e.g., "auth@1").
 * - Guarantees: single-flight refresh per key, bounded memory via LRU, and negative caching for hot misses.
 *
 * Invariants:
 * - Environment invariance: no env access here; owners pass all tuning via constructor/arguments.
 * - Single concern: cache orchestration only (no DB/HTTP).
 * - No silent fallbacks: invalid inputs throw.
 *
 * Notes:
 * - Gateway MUST respect facilitator TTL remainder (do not extend freshness).
 * - Negative caching is brief to avoid stampedes on unknown slugs/versions.
 */

export type IsoString = string;

export interface MirrorSnapshot<T> {
  snapshot: T;
  meta: {
    /** When the snapshot was produced by the loader (ISO). */
    generatedAt: IsoString;
    /** Facilitator-declared TTL *seconds* that downstreams must respect. */
    ttlSeconds: number;
  };
}

type InFlight<T> = Promise<MirrorSnapshot<T>>;

interface CacheEntry<T> {
  /** Cached value, if any (undefined for negative cache). */
  value?: MirrorSnapshot<T>;
  /** Epoch ms when this entry expires (stale after this moment). */
  expiresAt: number;
  /** In-flight refresh promise for single-flight behavior. */
  inFlight?: InFlight<T>;
  /** True when this entry represents a negative cache (e.g., not found). */
  negative?: boolean;
}

export interface MirrorStoreStats {
  size: number;
  inFlight: number;
  keys: string[];
}

export interface MirrorStoreOptions {
  /** Maximum number of cached keys before least-recently-used eviction. Required (>0). */
  maxEntries: number;
  /**
   * Negative-cache TTL (ms). Used when loader throws and callers treat it as non-existent.
   * Short but non-zero to prevent hot-miss stampedes. Required (>0).
   */
  negativeTtlMs: number;
  /**
   * Optional minimal logger; if omitted, logging is a no-op.
   * Intentionally generic to avoid coupling.
   */
  logger?: {
    debug?(o: unknown, msg?: string): void;
    info?(o: unknown, msg?: string): void;
    warn?(o: unknown, msg?: string): void;
    error?(o: unknown, msg?: string): void;
  };
}

/**
 * MirrorStore (v2)
 * - Per-key TTL cache with single-flight refresh and LRU eviction.
 * - Owner supplies a loader() that returns a fully-normalized MirrorSnapshot<T>.
 * - This class does not perform I/O; it coordinates caching only.
 */
export class MirrorStore<T> {
  private readonly maxEntries: number;
  private readonly negativeTtlMs: number;
  private readonly log: Required<NonNullable<MirrorStoreOptions["logger"]>>;

  /**
   * We use a Map as an LRU: delete+set on access pushes a key to the end (most recently used).
   */
  private readonly map = new Map<string, CacheEntry<T>>();

  constructor(opts: MirrorStoreOptions) {
    if (!opts || typeof opts.maxEntries !== "number" || opts.maxEntries <= 0) {
      throw new Error("MirrorStore: maxEntries must be a positive number");
    }
    if (
      !opts ||
      typeof opts.negativeTtlMs !== "number" ||
      opts.negativeTtlMs <= 0
    ) {
      throw new Error("MirrorStore: negativeTtlMs must be a positive number");
    }
    this.maxEntries = opts.maxEntries;
    this.negativeTtlMs = opts.negativeTtlMs;

    const noop = (_o?: unknown, _m?: string) => {};
    this.log = {
      debug: opts.logger?.debug ?? noop,
      info: opts.logger?.info ?? noop,
      warn: opts.logger?.warn ?? noop,
      error: opts.logger?.error ?? noop,
    };
  }

  /**
   * Get a snapshot for a key. Returns cached value if fresh, otherwise coalesces a refresh.
   *
   * @param key    Cache key "<slug>@<version>".
   * @param loader Async producer of MirrorSnapshot<T>; MUST set meta.generatedAt (ISO) and meta.ttlSeconds (>0).
   * @param ttlMs  Facilitator TTL in milliseconds for this key (owner-controlled). Required (>0).
   */
  async get(
    key: string,
    loader: () => Promise<MirrorSnapshot<T>>,
    ttlMs: number
  ): Promise<MirrorSnapshot<T>> {
    if (!key || typeof key !== "string") {
      throw new Error("MirrorStore.get: key must be a non-empty string");
    }
    if (typeof ttlMs !== "number" || ttlMs <= 0) {
      throw new Error("MirrorStore.get: ttlMs must be a positive number");
    }
    if (typeof loader !== "function") {
      throw new Error("MirrorStore.get: loader must be a function");
    }

    const now = Date.now();
    const existing = this.map.get(key);

    // Fresh hit path
    if (existing && existing.value && existing.expiresAt > now) {
      this.touch(key, existing);
      this.log.debug({ key }, "mirror_cache_hit");
      return existing.value;
    }

    // Coalesce concurrent refreshes
    if (existing?.inFlight) {
      this.log.debug({ key }, "mirror_single_flight_wait");
      return existing.inFlight;
    }

    // Start a refresh
    const inFlight = this.loadAndStore(key, loader, ttlMs);
    this.map.set(key, {
      value: existing?.value, // keep stale value around (not returned; freshness checked above)
      expiresAt: existing?.expiresAt ?? 0,
      inFlight,
      negative: existing?.negative,
    });

    try {
      const result = await inFlight;
      return result;
    } finally {
      this.evictIfNeeded();
    }
  }

  /**
   * Clear a specific key or the entire cache.
   */
  clear(key?: string): void {
    if (key) {
      this.map.delete(key);
    } else {
      this.map.clear();
    }
  }

  /**
   * Quick introspection — useful for health endpoints and smokes.
   */
  stats(): MirrorStoreStats {
    let inFlight = 0;
    for (const [, entry] of this.map) if (entry.inFlight) inFlight++;
    return {
      size: this.map.size,
      inFlight,
      keys: Array.from(this.map.keys()),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  private async loadAndStore(
    key: string,
    loader: () => Promise<MirrorSnapshot<T>>,
    ttlMs: number
  ): Promise<MirrorSnapshot<T>> {
    const startedAt = Date.now();

    try {
      const snap = await loader();

      // Validate loader meta
      if (
        !snap ||
        !snap.meta ||
        typeof snap.meta.generatedAt !== "string" ||
        typeof snap.meta.ttlSeconds !== "number" ||
        snap.meta.ttlSeconds <= 0
      ) {
        throw new Error("MirrorStore: loader returned invalid snapshot meta");
      }

      const expiresAt = Date.now() + ttlMs;
      const entry: CacheEntry<T> = {
        value: snap,
        expiresAt,
        inFlight: undefined,
        negative: false,
      };

      // Store + LRU touch
      this.map.set(key, entry);
      this.touch(key, entry);

      this.log.debug(
        {
          key,
          ttlMs,
          tookMs: Date.now() - startedAt,
          generatedAt: snap.meta.generatedAt,
          ttlSeconds: snap.meta.ttlSeconds,
        },
        "mirror_cache_refreshed"
      );

      this.evictIfNeeded();
      return snap;
    } catch (err) {
      // Negative cache: brief TTL to prevent hammering unknown keys
      const entry: CacheEntry<T> = {
        value: undefined,
        expiresAt: Date.now() + this.negativeTtlMs,
        inFlight: undefined,
        negative: true,
      };
      this.map.set(key, entry);
      this.touch(key, entry);

      this.log.warn({ key, err: String(err) }, "mirror_cache_negative_cached");
      throw err;
    } finally {
      // Remove inFlight marker, if present
      const cur = this.map.get(key);
      if (cur && cur.inFlight) {
        cur.inFlight = undefined;
        this.map.set(key, cur);
      }
    }
  }

  private touch(key: string, entry: CacheEntry<T>) {
    // Map preserves insertion order; delete+set to push to MRU end
    this.map.delete(key);
    this.map.set(key, entry);
  }

  private evictIfNeeded() {
    while (this.map.size > this.maxEntries) {
      const lruKey = this.map.keys().next().value as string | undefined;
      if (!lruKey) break;
      this.map.delete(lruKey);
      this.log.info({ key: lruKey }, "mirror_cache_evicted_lru");
    }
  }
}
