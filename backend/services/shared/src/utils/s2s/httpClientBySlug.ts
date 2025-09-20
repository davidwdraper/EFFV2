// PATH: backend/services/shared/src/utils/s2s/httpClientBySlug.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md   // APR-0029
 *
 * Why:
 * - Resolve target service API bases via the svcconfig **snapshot** (no network).
 * - Add **uniform S2S identity** + **X-NV-Api-Version** in one place so gateway
 *   and service→service behave identically (no drift).
 * - Respect an inbound X-NV-User-Assertion if present; otherwise mint a short-lived one.
 *
 * Notes:
 * - Caches base per (slug, apiVersion) in-process.
 * - External versions may be "V1"/"v1"/"1" at call sites; we normalize to "V#".
 */

import {
  s2sRequest,
  type S2SRequestOptions,
  type S2SResponse,
} from "./httpClient";
// Re-export public types for ergonomic imports by higher-level helpers
export type { S2SRequestOptions, S2SResponse } from "./httpClient";

import type { ServiceConfig } from "../../contracts/svcconfig.contract";
import { logger } from "../logger";
import { mintS2S } from "./mintS2S";
import { mintUserAssertion } from "./mintUserAssertion";

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
  if (!svcconfigMod) {
    svcconfigMod = await import("../../svcconfig/client");
  }
  return svcconfigMod;
}

function computeApiBase(cfg: ServiceConfig): string {
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
): ServiceConfig | null {
  // Accept several shapes without changing callers:
  // 1) Array<ServiceConfig>
  if (Array.isArray(snapServices)) {
    return (
      snapServices.find(
        (r: any) =>
          normSlug(r?.slug) === normSlug(slug) &&
          normVersion(r?.version || "V1") === normVersion(version)
      ) || null
    );
  }

  // 2) Record<string, unknown>
  if (snapServices && typeof snapServices === "object") {
    const bySlug = (snapServices as Record<string, any>)[normSlug(slug)];
    // 2a) Direct config with version field
    if (bySlug && typeof bySlug === "object" && bySlug.baseUrl) {
      return normVersion(bySlug.version || "V1") === normVersion(version)
        ? (bySlug as ServiceConfig)
        : null;
    }
    // 2b) Record of versions: services[slug][version]
    if (
      bySlug &&
      typeof bySlug === "object" &&
      (bySlug[normVersion(version)] || bySlug[version])
    ) {
      const vCfg = bySlug[normVersion(version)] || bySlug[version];
      return (vCfg as ServiceConfig) ?? null;
    }
    // 2c) Flat keys like "user.V1"
    const flatKey = `${normSlug(slug)}.${normVersion(version)}`.toLowerCase();
    if ((snapServices as any)[flatKey]) {
      return (snapServices as any)[flatKey] as ServiceConfig;
    }
  }

  return null;
}

async function resolveServiceConfig(
  slug: string,
  apiVersion: string
): Promise<ServiceConfig> {
  await ensureSvcconfigReady();
  const mod = await ensureSvcconfigModule();
  const snap = mod.getSvcconfigSnapshot();
  if (!snap) {
    throw new Error("[httpClientBySlug] svcconfig snapshot not initialized");
  }

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

  return cfg as ServiceConfig;
}

function mintHeaders(
  ver: string,
  inbound: Record<string, string | undefined>
): Record<string, string> {
  // Start from a clean map of defined string values only
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inbound || {})) {
    if (typeof v === "string") out[k] = v;
  }

  // Never forward client Authorization upstream; always mint fresh S2S
  delete out.authorization;
  delete out.Authorization as any;

  const ttlSec = Math.min(
    Number(process.env.S2S_MAX_TTL_SEC || 300) || 300,
    900
  );
  const caller = process.env.SERVICE_NAME || "gateway";
  out.authorization = `Bearer ${mintS2S({ ttlSec, meta: { svc: caller } })}`;

  // Preserve provided user assertion if present; otherwise mint a short-lived one
  const hasUA =
    typeof out["x-nv-user-assertion"] === "string" &&
    out["x-nv-user-assertion"]!.length > 0;
  if (!hasUA) {
    const sub = process.env.DEFAULT_USER_ASSERTION_SUB || "smoke-tests";
    out["x-nv-user-assertion"] = mintUserAssertion({ sub }, { ttlSec: 300 });
  }

  // Stamp canonical API version header ("V#")
  out["x-nv-api-version"] = ver;

  return out;
}

/**
 * Perform an S2S request to a service by slug.
 * `path` is the service-local API path (e.g., "/resolve"); outboundApiPrefix is added from svcconfig.
 * Adds S2S Authorization + X-NV-User-Assertion (if missing) + X-NV-Api-Version, then delegates to s2sRequest().
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

  // Merge headers and mint upstream identity (S2S + UA) and version
  const inboundHeaders = (opts.headers || {}) as Record<
    string,
    string | undefined
  >;
  const headers = mintHeaders(ver, inboundHeaders);

  const mergedOpts: S2SRequestOptions<TBody> = {
    ...opts,
    headers,
  };

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
