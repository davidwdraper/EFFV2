// backend/services/shared/src/svc/resolution/facilitator.resolver.ts
/**
 * FacilitatorResolver — strict S2S resolver
 *
 * Required facilitator envelope (RouterBase):
 * {
 *   ok: true,
 *   service: "svcfacilitator",
 *   data: { status: 200, body: {
 *     slug: string,
 *     version: number >=1,
 *     baseUrl: "http(s)://host[:port]",
 *     outboundApiPrefix: "/api" (no trailing "/"),
 *     etag: string
 *   }}
 * }
 *
 * Output for SvcClient:
 *   composedBase = <baseUrl><outboundApiPrefix>/<slug>/v<version>
 *
 * No defaults. No compatibility paths. Fail fast if shape is off.
 */

import type { UrlResolver } from "../types";

export type FacilitatorResolverOptions = {
  baseUrl?: string; // e.g. "http://127.0.0.1:4015"
  apiBasePath?: string; // default "/api/svcfacilitator"
  apiVersion?: number; // default FACILITATOR_API_VERSION or 1
  ttlMs?: number; // default 300_000
  timeoutMs?: number; // default 3_000
  fetchImpl?: typeof fetch;
  serviceName?: string; // optional x-service-name header
};

type CacheEntry = { composedBase: string; exp: number };

const API_PREFIX_RE = /^\/[A-Za-z0-9/-]*$/; // must start with "/", no trailing "/"
const PROD_NAMES = new Set(["production", "prod"]);
const CACHE_VERSION = "strict.v1";

export class FacilitatorResolver {
  private readonly baseUrl: string;
  private readonly apiBasePath: string;
  private readonly apiVersion: number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly serviceName?: string;

  private static cache = new Map<string, CacheEntry>();

  constructor(opts: FacilitatorResolverOptions = {}) {
    const envBase = (process.env.SVCFACILITATOR_BASE_URL || "").trim();
    this.baseUrl = (opts.baseUrl ?? envBase).trim();
    this.apiBasePath = (opts.apiBasePath ?? "/api/svcfacilitator").trim();
    const envApiVer = Number(process.env.FACILITATOR_API_VERSION ?? 1);
    this.apiVersion = Number.isFinite(opts.apiVersion ?? envApiVer)
      ? Number(opts.apiVersion ?? envApiVer)
      : 1;

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
    if (!Number.isInteger(this.apiVersion) || this.apiVersion < 1) {
      throw new Error(
        `FacilitatorResolver: invalid FACILITATOR_API_VERSION (${String(
          process.env.FACILITATOR_API_VERSION
        )}) — must be integer >= 1`
      );
    }
  }

  /** Returns composed base = <baseUrl><prefix>/<slug>/v<version> */
  public readonly resolve: UrlResolver = async (slug, version) => {
    if (!slug) throw new Error("FacilitatorResolver: slug is required");
    const ver = version ?? 1;
    if (!Number.isFinite(ver) || ver <= 0) {
      throw new Error(
        `FacilitatorResolver: invalid version: ${String(version)}`
      );
    }

    const cacheKey = `${slug}@v${ver}#${CACHE_VERSION}`;
    const now = Date.now();
    const hit = FacilitatorResolver.cache.get(cacheKey);
    if (hit && hit.exp > now) return hit.composedBase;

    const base = stripTrailingSlash(this.baseUrl);
    const root = stripTrailingSlash(this.apiBasePath);
    const url = `${base}${root}/v${
      this.apiVersion
    }/resolve?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(
      ver
    )}`;

    const res = await this.req(url);
    if (!res.ok) {
      throw new Error(
        `FacilitatorResolver: HTTP ${res.status} from facilitator`
      );
    }

    const raw = await res.text();
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(
        "FacilitatorResolver: non-JSON response from facilitator"
      );
    }

    // ── Strict RouterBase envelope: { ok, service, data: { status, body } } ──
    const body = extractRouterBaseBody(json);
    const rec = validateBody(body);

    assertHttpUrl(rec.baseUrl, "data.body.baseUrl");
    if (!isProduction()) {
      const u = new URL(rec.baseUrl);
      if (!u.port) {
        throw new Error(
          "FacilitatorResolver: baseUrl requires explicit port outside production"
        );
      }
    }
    requireApiPrefix(rec.outboundApiPrefix);

    const composedBase =
      stripTrailingSlash(rec.baseUrl) +
      rec.outboundApiPrefix +
      "/" +
      rec.slug +
      "/v" +
      rec.version;

    // eslint-disable-next-line no-console
    console.info("[FacilitatorResolver] composedBase", {
      slug: rec.slug,
      version: rec.version,
      composedBase,
    });

    FacilitatorResolver.cache.set(cacheKey, {
      composedBase,
      exp: now + this.ttlMs,
    });

    return composedBase;
  };

  public static invalidate(key?: string): void {
    if (key) FacilitatorResolver.cache.delete(key);
    else FacilitatorResolver.cache.clear();
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

// ── helpers ─────────────────────────────────────────────────────────────────

function extractRouterBaseBody(json: any): any {
  // Envelope must exist
  if (!json || typeof json !== "object") {
    throw new Error("FacilitatorResolver: invalid response (no object)");
  }
  if (json.ok !== true) {
    throw new Error("FacilitatorResolver: invalid response (ok !== true)");
  }
  if (!json.data || typeof json.data !== "object") {
    throw new Error("FacilitatorResolver: invalid response (missing data)");
  }
  const status = (json.data as any).status;
  const body = (json.data as any).body;
  if (!Number.isFinite(status) || status !== 200 || !body) {
    // Provide a tiny preview to aid debugging without dumping huge payloads
    const preview = JSON.stringify({ status, hasBody: Boolean(body) });
    throw new Error(
      `FacilitatorResolver: invalid envelope (expected data.status=200 & data.body). Preview=${preview}`
    );
  }
  return body;
}

function validateBody(body: any): {
  slug: string;
  version: number;
  baseUrl: string;
  outboundApiPrefix: string;
  etag: string;
} {
  const fails: string[] = [];
  const slug =
    typeof body?.slug === "string" ? body.slug : (fails.push("slug"), "");
  const version =
    Number.isFinite(body?.version) && Number(body.version) >= 1
      ? Number(body.version)
      : (fails.push("version"), 0);
  const baseUrl =
    typeof body?.baseUrl === "string" && body.baseUrl
      ? body.baseUrl
      : (fails.push("baseUrl"), "");
  const outboundApiPrefix =
    typeof body?.outboundApiPrefix === "string" &&
    API_PREFIX_RE.test(body.outboundApiPrefix) &&
    (!body.outboundApiPrefix.endsWith("/") || body.outboundApiPrefix === "/")
      ? body.outboundApiPrefix
      : (fails.push("outboundApiPrefix"), "");
  const etag =
    typeof body?.etag === "string" && body.etag
      ? body.etag
      : (fails.push("etag"), "");

  if (fails.length) {
    throw new Error(
      `FacilitatorResolver: invalid body fields: ${fails.join(", ")}`
    );
  }
  return { slug, version, baseUrl, outboundApiPrefix, etag };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
function parseNum(v: string | number | undefined, d: number): number {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : d;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}
function isProduction(): boolean {
  const mode = (process.env.MODE ?? process.env.NODE_ENV ?? "").toLowerCase();
  return PROD_NAMES.has(mode);
}
function assertHttpUrl(u: string, field = "url"): void {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error(`${field}: invalid absolute URL`);
  }
  const proto = parsed.protocol.toLowerCase();
  if (proto !== "http:" && proto !== "https:") {
    throw new Error(`${field}: unsupported protocol (expected http/https)`);
  }
  if (!parsed.hostname) throw new Error(`${field}: missing hostname`);
  const hostLower = parsed.hostname.toLowerCase();
  if (hostLower === "0.0.0.0" || hostLower === "::") {
    throw new Error(`${field}: unroutable host (${parsed.hostname})`);
  }
}
function requireApiPrefix(prefix: string): void {
  if (!API_PREFIX_RE.test(prefix))
    throw new Error("outboundApiPrefix: invalid path prefix");
  if (prefix.length > 1 && prefix.endsWith("/")) {
    throw new Error("outboundApiPrefix: must not end with '/' (e.g., '/api')");
  }
}

export function buildFacilitatorResolver(
  opts?: FacilitatorResolverOptions
): UrlResolver {
  return new FacilitatorResolver(opts).resolve;
}
