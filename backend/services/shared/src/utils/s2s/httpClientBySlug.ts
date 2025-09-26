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
 * Why:
 * - Resolve target service API bases via svcconfig **snapshot**.
 * - Add **uniform, KMS-only S2S identity** + **X-NV-Api-Version** in one place so
 *   gateway and service→service behave identically (no drift).
 * - Preserve/extend X-NV-Header-History across hops for auditability.
 *
 * Notes:
 * - Caches base per (slug, apiVersion) in-process.
 * - Never auto-mints X-NV-User-Assertion; only forwards if present.
 * - Disables 'Expect: 100-continue' by default to avoid PUT hangs.
 */

import {
  s2sRequest,
  type S2SRequestOptions,
  type S2SResponse,
} from "@eff/shared/src/utils/s2s/httpClient";
export type {
  S2SRequestOptions,
  S2SResponse,
} from "@eff/shared/src/utils/s2s/httpClient";

import type { SvcConfig } from "@eff/shared/src/contracts/svcconfig.contract";
import { logger } from "@eff/shared/src/utils/logger";
import {
  mintS2S,
  type MintS2SOptions,
} from "@eff/shared/src/utils/s2s/mintS2S";

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

// Cache: (slug,version) -> apiBase
const apiBaseCache = new Map<string, string>();

// Lazy svcconfig module handle
let svcconfigMod: {
  getSvcconfigSnapshot: () => any;
  startSvcconfigMirror: () => void;
} | null = null;
async function ensureSvcconfigModule() {
  if (!svcconfigMod)
    svcconfigMod = await import("@eff/shared/src/svcconfig/client");
  return svcconfigMod;
}

function computeApiBase(cfg: SvcConfig): string {
  const base = stripTrailing(String(cfg.baseUrl || ""));
  const prefix = ensureLeading(String(cfg.outboundApiPrefix || "/api"));
  return `${base}${prefix}`;
}

async function ensureSvcconfigReady(timeoutMs = 1000): Promise<void> {
  const mod = await ensureSvcconfigModule();
  if (mod.getSvcconfigSnapshot()) return;

  try {
    void mod.startSvcconfigMirror();
    logger.info("[httpClientBySlug] started svcconfig mirror (lazy)");
  } catch (err) {
    logger.warn({ err }, "[httpClientBySlug] failed to start svcconfig mirror");
  }

  const start = Date.now();
  let backoff = 50;
  while (Date.now() - start < timeoutMs) {
    if (mod.getSvcconfigSnapshot()) return;
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 200);
  }
  throw new Error(
    "[httpClientBySlug] svcconfig snapshot unavailable after lazy bootstrap"
  );
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

async function resolveServiceConfig(
  slug: string,
  apiVersion: string
): Promise<SvcConfig> {
  await ensureSvcconfigReady();
  const snap = (await ensureSvcconfigModule()).getSvcconfigSnapshot();
  if (!snap)
    throw new Error("[httpClientBySlug] svcconfig snapshot not initialized");

  const wantedVer = normVersion(apiVersion);
  const cfg = pickByVersion(snap.services, slug, wantedVer);

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

/**
 * Merge headers and mint upstream identity (KMS S2S) and version.
 * - Never forward client Authorization.
 * - Do NOT auto-mint user assertions; forward only if present.
 * - Disable 100-continue by default.
 * - Preserve/extend header history.
 */
async function finalizeHeaders(
  ver: string,
  inbound: Record<string, string | undefined>,
  s2sExtra?: MintS2SOptions["extra"]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inbound || {})) {
    if (typeof v === "string") out[k.toLowerCase()] = v;
  }

  // Never forward edge Authorization
  delete out.authorization;

  // KMS S2S — single source of truth inside mintS2S (KMS-only, no fallback)
  const ttlSec = Math.min(
    Number(process.env.S2S_MAX_TTL_SEC || 300) || 300,
    900
  );
  out.authorization = `Bearer ${mintS2S({ ttlSec, extra: s2sExtra })}`;

  // X-NV-User-Assertion: forward only if present; do NOT mint here.

  // Stamp canonical API version
  out["x-nv-api-version"] = ver;

  // Disable 100-continue stalls unless caller explicitly set otherwise
  if (out["expect"] === undefined) out["expect"] = "";

  // Sensible default Accept
  out["accept"] = out["accept"] || "application/json";

  // ---- Header history (append-only) ---------------------------------------
  // base64url(JSON array of hops). Each hop: { ts, svc, ver, reqId? }
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

/**
 * Perform an S2S request to a service by slug.
 * `path` is the service-local API path (e.g., "/resolve"); outboundApiPrefix is added from svcconfig.
 * Adds S2S Authorization + (optional) forwarded X-NV-User-Assertion + X-NV-Api-Version, then delegates to s2sRequest().
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

  if (!apiBase) {
    const cfg = await resolveServiceConfig(slug, ver);
    apiBase = computeApiBase(cfg);
    apiBaseCache.set(key, apiBase);
    logger.info(
      { slug, apiVersion: ver, apiBase },
      "[httpClientBySlug] cached api base"
    );
  }

  const target = `${stripTrailing(apiBase)}${ensureLeading(path)}`;

  // Finalize headers (KMS S2S, version header, expect-empty, header history)
  const inboundHeaders = (opts.headers || {}) as Record<
    string,
    string | undefined
  >;
  const headers = await finalizeHeaders(
    ver,
    inboundHeaders,
    (opts as any)?.s2s?.extra
  );

  const mergedOpts: S2SRequestOptions<TBody> = { ...opts, headers };

  return s2sRequest<TResp, TBody>(target, mergedOpts);
}

/** Optional prewarm (safe to call multiple times). */
export async function prewarmSlug(
  slug: string,
  apiVersion: string
): Promise<void> {
  const ver = normVersion(apiVersion);
  const key = `${normSlug(slug)}::${ver}`;
  if (apiBaseCache.has(key)) return;
  const cfg = await resolveServiceConfig(slug, ver);
  const apiBase = computeApiBase(cfg);
  apiBaseCache.set(key, apiBase);
  logger.info(
    { slug, apiVersion: ver, apiBase },
    "[httpClientBySlug] prewarmed api base"
  );
}
