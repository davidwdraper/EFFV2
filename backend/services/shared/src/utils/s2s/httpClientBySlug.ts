// backend/services/shared/src/utils/s2s/httpClientBySlug.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md   // APR-0029
 *   - docs/adr/0036-single-s2s-client-kms-only-callBySlug.md  // NEW
 *
 * Purpose:
 * - Resolve target service bases via svcconfig **snapshot**.
 * - Add uniform, KMS-only S2S identity + X-NV-Api-Version.
 * - Preserve/extend X-NV-Header-History across hops.
 *
 * Notes:
 * - Caches base per (slug, apiVersion) in-process.
 * - Health paths go to **rootBase**, not apiBase.
 */

import {
  s2sRequest,
  type S2SRequestOptions,
  type S2SResponse,
} from "../../utils/s2s/httpClient";
export type {
  S2SRequestOptions,
  S2SResponse,
} from "../../utils/s2s/httpClient";

import type { SvcConfig } from "../../contracts/svcconfig.contract";
import { logger } from "../../utils/logger";
import { mintS2S } from "../../utils/s2s/mintS2S";
import {
  getSvcconfigSnapshot,
  startSvcconfigMirror,
} from "../../svcconfig/client";

// ---------- helpers ----------
const ensureLeading = (p: string) => (p.startsWith("/") ? p : `/${p}`);
const stripTrailing = (p: string) => p.replace(/\/+$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const normSlug = (s: string) =>
  String(s || "")
    .trim()
    .toLowerCase();
const normVersion = (v: string) => {
  const m = String(v || "")
    .trim()
    .match(/^v?(\d+)$/i);
  if (!m)
    throw new Error(
      `[httpClientBySlug] invalid apiVersion "${v}" (use V1, v2, 3, ...)`
    );
  return `V${m[1]}`;
};

// Typed HTTP method union to satisfy S2SRequestOptions.method
type HttpMethod = Exclude<S2SRequestOptions<any>["method"], undefined>;
function normalizeMethod(
  m?: S2SRequestOptions<any>["method"] | string
): HttpMethod {
  const s = String(m ?? "GET").toUpperCase();
  switch (s) {
    case "GET":
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
    case "HEAD":
      return s;
    default:
      return "GET";
  }
}

// Cache: (slug,version) -> apiBase; and a rootBase for health
const apiBaseCache = new Map<string, string>();
const rootBaseCache = new Map<string, string>();

function computeBases(cfg: SvcConfig): { root: string; api: string } {
  const root = stripTrailing(String(cfg.baseUrl || ""));
  const prefRaw = (cfg as any).outboundApiPrefix ?? "/api";
  const pref = prefRaw
    ? String(prefRaw).startsWith("/")
      ? String(prefRaw)
      : `/${String(prefRaw)}`
    : "";
  const api = stripTrailing(`${root}${pref}`);
  return { root, api };
}

async function ensureSvcconfigReady(timeoutMs = 1000): Promise<void> {
  if (getSvcconfigSnapshot()) return;
  try {
    void startSvcconfigMirror();
    logger.info("[httpClientBySlug] started svcconfig mirror (lazy)");
  } catch (err) {
    logger.warn({ err }, "[httpClientBySlug] failed to start svcconfig mirror");
  }
  const start = Date.now();
  let backoff = 50;
  while (Date.now() - start < timeoutMs) {
    if (getSvcconfigSnapshot()) return;
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 200);
  }
  // NOTE: do not throw; downstream will attempt a targeted refresh on miss.
}

function pickByVersion(
  snapServices: any,
  slug: string,
  version: string
): SvcConfig | null {
  if (Array.isArray(snapServices)) {
    return (
      snapServices.find(
        (r: any) =>
          normSlug(r?.slug) === normSlug(slug) &&
          normVersion(r?.version || "V1") === normVersion(version)
      ) || null
    );
  }
  if (snapServices && typeof snapServices === "object") {
    const bySlug = (snapServices as Record<string, any>)[normSlug(slug)];
    if (bySlug?.baseUrl) {
      return normVersion(bySlug.version || "V1") === normVersion(version)
        ? (bySlug as SvcConfig)
        : null;
    }
    if (bySlug && (bySlug[normVersion(version)] || bySlug[version])) {
      return (bySlug[normVersion(version)] || bySlug[version]) as SvcConfig;
    }
    const flatKey = `${normSlug(slug)}.${normVersion(version)}`.toLowerCase();
    if ((snapServices as any)[flatKey])
      return (snapServices as any)[flatKey] as SvcConfig;
  }
  return null;
}

/**
 * Resolve a service config, with a ONE-TIME, on-demand refresh if the slug is missing.
 */
async function resolveServiceConfig(
  slug: string,
  apiVersion: string
): Promise<SvcConfig> {
  await ensureSvcconfigReady();

  const wantedVer = normVersion(apiVersion);

  // 1) Try current snapshot
  let snap = getSvcconfigSnapshot();
  if (!snap)
    throw new Error("[httpClientBySlug] svcconfig snapshot not initialized");

  let cfg = pickByVersion(snap.services, slug, wantedVer);

  // 2) Not found? Force a refresh from authority and retry exactly once.
  if (!cfg) {
    try {
      logger.warn(
        { slug, apiVersion: wantedVer },
        "[httpClientBySlug] miss in snapshot; forcing svcconfig refresh"
      );
      await startSvcconfigMirror(); // idempotent bootstrap/refresh
      snap = getSvcconfigSnapshot();
      if (snap) cfg = pickByVersion(snap.services, slug, wantedVer);
    } catch (err) {
      logger.warn(
        { slug, apiVersion: wantedVer, err },
        "[httpClientBySlug] svcconfig refresh failed"
      );
    }
  }

  if (!cfg)
    throw new Error(
      `[httpClientBySlug] unknown (slug="${slug}", version="${wantedVer}")`
    );
  if (cfg.enabled !== true)
    throw new Error(
      `[httpClientBySlug] service "${slug}" version "${wantedVer}" is disabled`
    );

  return cfg as SvcConfig;
}

function isHealthPath(p: string): boolean {
  const s = p.startsWith("/") ? p.slice(1) : p;
  // Unversioned health endpoints live at service root per ADR-0016
  return (
    s === "health" ||
    s.startsWith("health/") ||
    s === "live" ||
    s === "ready" ||
    s.startsWith("ready") ||
    s.startsWith("live")
  );
}

/**
 * Perform an S2S request to a service by slug.
 * - `path` is service-local. Health paths are sent to ROOT (no outboundApiPrefix).
 * - Adds a breadcrumb with the exact upstream target and base selection.
 * - For GET/HEAD, ensures no body is passed (avoids undici UND_ERR_NOT_SUPPORTED).
 */
export async function s2sRequestBySlug<TResp = unknown, TBody = unknown>(
  slug: string,
  apiVersion: string,
  path: string,
  opts: S2SRequestOptions<TBody> = {}
): Promise<S2SResponse<TResp>> {
  const ver = normVersion(apiVersion);
  const key = `${normSlug(slug)}::${ver}`;
  let apiBase = apiBaseCache.get(key);
  let rootBase = rootBaseCache.get(key);

  if (!apiBase || !rootBase) {
    const cfg = await resolveServiceConfig(slug, ver);
    const bases = computeBases(cfg);
    apiBase = bases.api;
    rootBase = bases.root;
    apiBaseCache.set(key, apiBase);
    rootBaseCache.set(key, rootBase);
    logger.info(
      { slug, apiVersion: ver, apiBase, rootBase },
      "[httpClientBySlug] cached bases"
    );
  }

  const baseKind = isHealthPath(path) ? "root" : "api";
  const base = baseKind === "root" ? (rootBase as string) : (apiBase as string);
  const target = `${base}${ensureLeading(path)}`.replace(/([^:]\/)\/+/g, "$1");

  const inboundHeaders = (opts.headers || {}) as Record<
    string,
    string | undefined
  >;
  const headers = await finalizeHeaders(ver, inboundHeaders);

  const method: HttpMethod = normalizeMethod(opts.method as any);
  const mergedOpts: S2SRequestOptions<TBody> = {
    ...opts,
    method, // <- correctly typed literal union
    headers,
    ...(method === "GET" || method === "HEAD"
      ? { body: undefined as any }
      : {}),
  };

  logger.debug(
    { slug, ver, path, target, baseKind, method },
    "[httpClientBySlug] upstream"
  );

  return s2sRequest<TResp, TBody>(target, mergedOpts);
}

/** Optional prewarm (safe to call multiple times). */
export async function prewarmSlug(
  slug: string,
  apiVersion: string
): Promise<void> {
  const ver = normVersion(apiVersion);
  const key = `${normSlug(slug)}::${ver}`;
  if (apiBaseCache.has(key) && rootBaseCache.has(key)) return;
  const cfg = await resolveServiceConfig(slug, ver);
  const { root, api } = computeBases(cfg);
  apiBaseCache.set(key, api);
  rootBaseCache.set(key, root);
  logger.info(
    { slug, apiVersion: ver, apiBase: api, rootBase: root },
    "[httpClientBySlug] prewarmed bases"
  );
}

/**
 * Merge headers and mint upstream identity (KMS S2S) and version.
 * - Never forward client Authorization.
 * - Do NOT auto-mint user assertions; forward only if present.
 * - Disable 100-continue by default.
 * - Preserve/extend header history.
 */
async function finalizeHeaders(
  ver: string,
  inbound: Record<string, string | undefined>
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inbound || {})) {
    if (typeof v === "string") out[k.toLowerCase()] = v;
  }
  delete out.authorization;

  const ttlSec = Math.min(
    Number(process.env.S2S_MAX_TTL_SEC || 300) || 300,
    900
  );
  const s2s = await mintS2S({ ttlSec });
  out.authorization = `Bearer ${s2s}`;

  out["x-nv-api-version"] = ver;
  if (out["expect"] === undefined) out["expect"] = "";
  out["accept"] = out["accept"] || "application/json";

  // header history (append)
  try {
    const svc = process.env.SERVICE_NAME || "gateway";
    const hop = {
      ts: new Date().toISOString(),
      svc,
      ver,
      reqId: out["x-request-id"] || undefined,
    };
    const enc = (s: string) => Buffer.from(s, "utf8").toString("base64url");
    const dec = (s: string) => Buffer.from(s, "base64url").toString("utf8");
    const prev = out["x-nv-header-history"];
    let arr: any[] = [];
    if (typeof prev === "string" && prev.length > 0) {
      try {
        arr = JSON.parse(dec(prev));
      } catch {
        arr = [];
      }
    }
    arr.push(hop);
    out["x-nv-header-history"] = enc(JSON.stringify(arr));
  } catch {
    /* non-fatal */
  }
  return out;
}
