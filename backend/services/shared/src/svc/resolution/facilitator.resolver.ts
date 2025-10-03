// backend/shared/src/svc/resolution/facilitator.resolver.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 (Non-gateway S2S via svcfacilitator + TTL cache)
 *
 * Purpose:
 * - Single-responsibility helper that resolves (slug, version) → baseUrl
 *   by calling the svcfacilitator and caching results with TTL.
 *
 * Notes:
 * - Controllers/services know NOTHING about the facilitator; only SvcClient
 *   (or the gateway) uses this helper.
 * - Fail-fast on missing config; no silent fallbacks.
 * - Includes small utilities to invalidate/seed cache for tests.
 */

import type { UrlResolver } from "../types";

export type FacilitatorResolverOptions = {
  /** Base URL to the facilitator, e.g. "http://127.0.0.1:4015". Required unless provided via env. */
  baseUrl?: string;
  /** Resolve path on the facilitator. Default: "/api/svcfacilitator/resolve". */
  resolvePath?: string;
  /** TTL for cache entries in ms. Default: env SVC_RESOLVE_TTL_MS or 300000 (5 min). */
  ttlMs?: number;
  /** Timeout for facilitator HTTP call in ms. Default: env SVC_RESOLVE_TIMEOUT_MS or 3000. */
  timeoutMs?: number;
  /** Optional fetch impl injection (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional service-name header value; defaults to env SVC_NAME if present. */
  serviceName?: string;
};

type CacheEntry = { baseUrl: string; exp: number };

export class FacilitatorResolver {
  private readonly baseUrl: string;
  private readonly resolvePath: string;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly serviceName?: string;

  // Per-process cache (shared across instances of this helper).
  private static cache = new Map<string, CacheEntry>();

  constructor(opts: FacilitatorResolverOptions = {}) {
    const envBase = (process.env.SVCFACILITATOR_BASE_URL || "").trim();
    this.baseUrl = (opts.baseUrl ?? envBase).trim();
    this.resolvePath = (
      opts.resolvePath ?? "/api/svcfacilitator/resolve"
    ).trim();
    this.ttlMs = num(opts.ttlMs ?? process.env.SVC_RESOLVE_TTL_MS, 300000);
    this.timeoutMs = num(
      opts.timeoutMs ?? process.env.SVC_RESOLVE_TIMEOUT_MS,
      3000
    );
    this.fetchImpl = opts.fetchImpl ?? fetch;

    // Avoid mixing ?? and || without parentheses — make env value undefined if blank.
    const envSvcName = (process.env.SVC_NAME ?? "").trim() || undefined;
    this.serviceName = opts.serviceName ?? envSvcName;

    if (!this.baseUrl) {
      throw new Error(
        "FacilitatorResolver: SVCFACILITATOR_BASE_URL is required but not set"
      );
    }
  }

  /** UrlResolver function: resolves a baseUrl for (slug, version) with TTL caching. */
  public readonly resolve: UrlResolver = async (slug, version) => {
    if (!slug) throw new Error("FacilitatorResolver: slug is required");

    // ✅ Handle possibly-undefined version (UrlResolver may declare it optional); default to v1.
    const ver = version ?? 1;
    if (!Number.isFinite(ver) || ver <= 0) {
      throw new Error(
        `FacilitatorResolver: invalid version: ${String(version)}`
      );
    }

    const key = `${slug}@v${ver}`;
    const now = Date.now();

    // Cache hit
    const hit = FacilitatorResolver.cache.get(key);
    if (hit && hit.exp > now) return hit.baseUrl;

    // Cache miss → fetch from facilitator
    const url =
      stripTrailingSlash(this.baseUrl) +
      this.resolvePath +
      `?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(ver)}`;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);

    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          ...(this.serviceName ? { "x-service-name": this.serviceName } : {}),
        },
        signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(`FacilitatorResolver: fetch failed: ${String(e)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      throw new Error(
        `FacilitatorResolver: HTTP ${resp.status} from facilitator`
      );
    }

    let json: any;
    try {
      json = await resp.json();
    } catch {
      throw new Error(
        "FacilitatorResolver: non-JSON response from facilitator"
      );
    }

    // Expected shape: { ok: true, data: { baseUrl: "http://127.0.0.1:4020" } }
    const base = json?.data?.baseUrl;
    if (typeof base !== "string" || !base) {
      throw new Error(
        "FacilitatorResolver: invalid response shape — missing data.baseUrl"
      );
    }

    FacilitatorResolver.cache.set(key, {
      baseUrl: base,
      exp: now + this.ttlMs,
    });
    return base;
  };

  /** Test helper: clear whole cache or a single key (slug@vN). */
  public static invalidate(key?: string): void {
    if (key) FacilitatorResolver.cache.delete(key);
    else FacilitatorResolver.cache.clear();
  }

  /** Test/helper: seed a value manually (e.g., for offline tests). */
  public static seed(
    slug: string,
    version: number,
    baseUrl: string,
    ttlMs?: number
  ): void {
    const exp =
      Date.now() + (ttlMs ?? num(process.env.SVC_RESOLVE_TTL_MS, 300000));
    FacilitatorResolver.cache.set(`${slug}@v${version}`, { baseUrl, exp });
  }
}

/** Convenience factory returning a plain UrlResolver function. */
export function buildFacilitatorResolver(
  opts?: FacilitatorResolverOptions
): UrlResolver {
  const inst = new FacilitatorResolver(opts);
  return inst.resolve;
}

// ===== helpers ===================================================================

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
function num(v: string | number | undefined, d: number): number {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : d;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}
