// backend/services/shared/src/dto/DtoCache.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire format)
 *   - ADR-0065 (DtoCache — In-Process TTL Cache for DTO Collections) [planned]
 *
 * Purpose:
 * - Generic, in-process TTL cache for DTO collections.
 * - Designed for infra rails (svcconfig, prompts, etc.), NOT for controllers/pipelines.
 * - Stores bare DTO instances internally (no DtoBag identity), but accepts/returns
 *   DtoBag<TDto> at the edges so it plays nicely with the existing rails.
 *
 * Invariants:
 * - Keys are opaque strings (caller defines the key space, e.g. "env:slug:version").
 * - Internally stores arrays of DTOs, never DtoBag instances.
 * - On read, always returns a *fresh* DtoBag built from the cached DTO array.
 * - TTL is enforced per key; expired entries are treated as cache misses.
 *
 * Notes:
 * - This cache is process-local only. It is NOT shared across processes or nodes.
 * - Intended to be composed into resolvers (e.g., svcconfig resolvers) and SvcClient
 *   helpers, not exposed to business code or handlers.
 */

import { DtoBag } from "./DtoBag";

type CacheEntry<TDto> = {
  dtos: TDto[];
  expiresAt: number;
};

export type DtoCacheKey = string;

export type DtoCacheNowProvider = () => number;

export interface DtoCacheOptions<TDto> {
  /**
   * Time-to-live in milliseconds for each entry.
   * After `createdAt + ttlMs`, the entry is considered expired and will be
   * treated as a cache miss.
   */
  ttlMs: number;
  /**
   * Factory to create a DtoBag from an array of DTOs.
   * This avoids assuming static constructors on DtoBag and keeps this cache
   * decoupled from DtoBag internals.
   */
  bagFactory: (dtos: TDto[]) => DtoBag<TDto>;
  /**
   * Optional clock provider, primarily for testing.
   * Defaults to Date.now.
   */
  nowProvider?: DtoCacheNowProvider;
}

/**
 * DtoCache<TDto>
 *
 * - Storage service (not a value object).
 * - Owns multiple cached DTO collections keyed by arbitrary string keys.
 * - Accepts DtoBag<TDto> at the edge, strips to DTO arrays for storage.
 * - Returns fresh DtoBag<TDto> instances on reads using the provided bagFactory.
 */
export class DtoCache<TDto> {
  private readonly ttlMs: number;
  private readonly bagFactory: (dtos: TDto[]) => DtoBag<TDto>;
  private readonly now: DtoCacheNowProvider;

  private readonly entries = new Map<DtoCacheKey, CacheEntry<TDto>>();

  constructor(options: DtoCacheOptions<TDto>) {
    if (options.ttlMs <= 0) {
      throw new Error(
        "DtoCache: ttlMs must be > 0. Ops: choose a small, positive TTL (e.g., 3000–30000 ms) " +
          "so config changes (like disabling a service) are respected quickly."
      );
    }

    this.ttlMs = options.ttlMs;
    this.bagFactory = options.bagFactory;
    this.now = options.nowProvider ?? Date.now;
  }

  /**
   * Store the contents of a DtoBag under the given key.
   *
   * - Supports singleton and multi-item bags transparently.
   * - We copy the DTO references into an array and drop the DtoBag identity.
   * - On read, a *new* DtoBag is built using bagFactory.
   */
  public putBag(key: DtoCacheKey, bag: DtoBag<TDto>): void {
    // NOTE: We intentionally do not assume DtoBag internals; we rely on it
    // exposing an items() method that returns a readonly array of DTOs.
    const dtos = (bag as any).items?.() as readonly TDto[] | undefined;
    if (!dtos) {
      throw new Error(
        "DtoCache.putBag: DtoBag is missing items(). Ops: ensure DtoBag exposes items(): readonly TDto[]."
      );
    }

    const now = this.now();
    this.entries.set(key, {
      dtos: [...dtos], // copy to avoid accidental external mutation
      expiresAt: now + this.ttlMs,
    });
  }

  /**
   * Retrieve a cached bag for the given key.
   *
   * - Returns null if the key is missing or expired.
   * - Returns a *fresh* DtoBag<TDto> built from the cached DTO array.
   * - The returned bag may hold one or many DTOs, depending on what was cached.
   */
  public getBag(key: DtoCacheKey): DtoBag<TDto> | null {
    const now = this.now();
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= now) {
      // Expired: delete and treat as miss.
      this.entries.delete(key);
      return null;
    }

    // Re-bag the DTOs into a fresh DtoBag instance.
    return this.bagFactory([...entry.dtos]);
  }

  /**
   * Explicitly remove a cached entry for the given key, if present.
   */
  public delete(key: DtoCacheKey): void {
    this.entries.delete(key);
  }

  /**
   * Drop all cached entries.
   */
  public clear(): void {
    this.entries.clear();
  }

  /**
   * Opportunistically prune expired entries.
   *
   * - Safe to call on any cadence (e.g., on a timer or during housekeeping).
   * - Does nothing functionally that getBag() doesn't already enforce;
   *   it just keeps the Map from growing unbounded with expired entries.
   */
  public pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
