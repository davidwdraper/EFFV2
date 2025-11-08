// backend/services/jwks/src/jwks/JwksCache.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/jwks/JwksCache.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0035 — JWKS via GCP KMS with TTL Cache
 *
 * Purpose:
 * - Small, single-concern in-memory TTL cache for the JWKS Set.
 * - Prevents thundering herds with a single in-flight refresh promise.
 *
 * Invariants:
 * - No background pollers (v1). Refresh happens on demand only.
 * - No silent fallbacks: if cache is cold and refresh fails, we throw.
 * - Environment invariance: TTL is injected by owner; no defaults here.
 */

import type { JwkSet } from "@nv/shared/contracts/security/jwks.contract";

export type FetchJwksFn = () => Promise<JwkSet>;

type CacheEntry = {
  value: JwkSet;
  expiresAt: number; // epoch ms
};

export class JwksCache {
  private entry: CacheEntry | null = null;
  private inFlight: Promise<JwkSet> | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly fetcher: FetchJwksFn
  ) {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("JwksCache: ttlMs must be a positive integer");
    }
    if (typeof fetcher !== "function") {
      throw new Error("JwksCache: fetcher must be a function");
    }
  }

  /**
   * Get the current JWKS, refreshing if expired or missing.
   * If a refresh is already in progress, callers await the same promise.
   */
  async get(): Promise<JwkSet> {
    const now = Date.now();

    if (this.entry && this.entry.expiresAt > now) {
      return this.entry.value;
    }

    // If a refresh is already running, await it.
    if (this.inFlight) {
      return this.inFlight;
    }

    // Start a single refresh
    this.inFlight = (async () => {
      try {
        const value = await this.fetcher();
        this.entry = { value, expiresAt: now + this.ttlMs };
        return value;
      } finally {
        // Always clear the inFlight marker so future calls can trigger a new refresh if needed.
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  /**
   * Force a refresh on next get() by expiring the entry immediately.
   * Useful for admin triggers or rotation tests.
   */
  expireNow(): void {
    if (this.entry) {
      this.entry.expiresAt = 0;
    }
  }

  /**
   * Returns milliseconds until expiry (0 if expired or empty).
   */
  msUntilExpiry(): number {
    if (!this.entry) return 0;
    const delta = this.entry.expiresAt - Date.now();
    return delta > 0 ? delta : 0;
  }
}
