// backend/services/shared/src/svc/resolution/facilitator.resolver.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0007: S2S resolution via svcfacilitator (fixed contract)
 *
 * Contract (authoritative):
 *   GET {BASE}/api/svcfacilitator/resolve?slug=<slug>&version=<major>
 *   → 200 JSON: { ok: true, data: { baseUrl: "http://host:port" } }
 *
 * Purpose:
 * - Resolve (slug, version) → baseUrl with small TTL cache.
 * - Fail fast on missing/invalid config or response shape.
 */

import type { UrlResolver } from "../types";

export type FacilitatorResolverOptions = {
  /** e.g., "http://127.0.0.1:4015". If omitted, read SVCFACILITATOR_BASE_URL. */
  baseUrl?: string;
  /** Base path for facilitator API (without query). Default: "/api/svcfacilitator". */
  apiBasePath?: string;
  /** Cache TTL ms (default 300_000). */
  ttlMs?: number;
  /** HTTP timeout ms (default 3000). */
  timeoutMs?: number;
  /** Optional fetch impl for tests. */
  fetchImpl?: typeof fetch;
  /** Optional x-service-name header. Defaults to SVC_NAME if present. */
  serviceName?: string;
};

type CacheEntry = { baseUrl: string; exp: number };

export class FacilitatorResolver {
  private readonly baseUrl: string;
  private readonly apiBasePath: string;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly serviceName?: string;

  private static cache = new Map<string, CacheEntry>();

  constructor(opts: FacilitatorResolverOptions = {}) {
    const envBase = (process.env.SVCFACILITATOR_BASE_URL || "").trim();
    this.baseUrl = (opts.baseUrl ?? envBase).trim();
    this.apiBasePath = (opts.apiBasePath ?? "/api/svcfacilitator").trim();
    this.ttlMs = parseNum(
      opts.ttlMs ?? process.env.SVC_RESOLVE_TTL_MS,
      300_000
    );
    this.timeoutMs = parseNum(
      opts.timeoutMs ?? process.env.SVC_RESOLVE_TIMEOUT_MS,
      3_000
    );
    this.fetchImpl = opts.fetchImpl ?? fetch;
    const envSvcName = (process.env.SVC_NAME ?? "").trim() || undefined;
    this.serviceName = opts.serviceName ?? envSvcName;

    if (!this.baseUrl) {
      throw new Error(
        "FacilitatorResolver: SVCFACILITATOR_BASE_URL is required but not set"
      );
    }
  }

  /** Fixed-shape UrlResolver: (slug, version) → baseUrl */
  public readonly resolve: UrlResolver = async (slug, version) => {
    if (!slug) throw new Error("FacilitatorResolver: slug is required");
    const ver = version ?? 1;
    if (!Number.isFinite(ver) || ver <= 0) {
      throw new Error(
        `FacilitatorResolver: invalid version: ${String(version)}`
      );
    }

    const key = `${slug}@v${ver}`;
    const now = Date.now();
    const hit = FacilitatorResolver.cache.get(key);
    if (hit && hit.exp > now) return hit.baseUrl;

    const base = stripSlash(this.baseUrl);
    const root = this.apiBasePath.replace(/\/+$/, "");
    const url = `${base}${root}/resolve?slug=${encodeURIComponent(
      slug
    )}&version=${encodeURIComponent(ver)}`;

    const r = await this.req(url);
    if (!r.ok)
      throw new Error(`FacilitatorResolver: HTTP ${r.status} from facilitator`);

    let json: any;
    try {
      json = await r.json();
    } catch {
      throw new Error(
        "FacilitatorResolver: non-JSON response from facilitator"
      );
    }

    const found = json?.data?.baseUrl;
    if (typeof found !== "string" || !found) {
      throw new Error(
        "FacilitatorResolver: invalid response shape — expected data.baseUrl"
      );
    }

    FacilitatorResolver.cache.set(key, {
      baseUrl: found,
      exp: now + this.ttlMs,
    });
    return found;
  };

  /** Test helper: clear cache or single key (slug@vN). */
  public static invalidate(key?: string): void {
    if (key) FacilitatorResolver.cache.delete(key);
    else FacilitatorResolver.cache.clear();
  }

  /** Test helper: seed known mapping. */
  public static seed(
    slug: string,
    version: number,
    baseUrl: string,
    ttlMs?: number
  ): void {
    const exp =
      Date.now() + (ttlMs ?? parseNum(process.env.SVC_RESOLVE_TTL_MS, 300_000));
    FacilitatorResolver.cache.set(`${slug}@v${version}`, { baseUrl, exp });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async req(u: string): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(u, {
        method: "GET",
        headers: {
          accept: "application/json",
          ...(this.serviceName ? { "x-service-name": this.serviceName } : {}),
        },
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export function buildFacilitatorResolver(
  opts?: FacilitatorResolverOptions
): UrlResolver {
  return new FacilitatorResolver(opts).resolve;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function stripSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
function parseNum(v: string | number | undefined, d: number): number {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : d;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}
