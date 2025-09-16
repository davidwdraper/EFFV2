// backend/services/shared/src/utils/s2s/httpClientBySlug.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Resolve target service API bases via the svcconfig **snapshot**.
 * - Import svcconfig client **dynamically** after envs are loaded; never at module top-level.
 * - After composing the target URL, delegate the call to the standard S2S http client.
 *
 * Notes:
 * - Inside shared, use **relative** imports to avoid self-aliasing.
 * - Caches base per (slug, apiVersion) in-process.
 * - apiVersion is accepted for forward-compat (ignored in base computation for now).
 */

import {
  s2sRequest,
  type S2SRequestOptions,
  type S2SResponse,
} from "./httpClient";
import type { ServiceConfig } from "../../contracts/svcconfig.contract";
import { logger } from "../logger";

const ensureLeading = (p: string) => (p.startsWith("/") ? p : `/${p}`);
const stripTrailing = (p: string) => p.replace(/\/+$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function resolveServiceConfig(slug: string): Promise<ServiceConfig> {
  await ensureSvcconfigReady();
  const mod = await ensureSvcconfigModule();
  const snap = mod.getSvcconfigSnapshot();
  if (!snap)
    throw new Error("[httpClientBySlug] svcconfig snapshot not initialized");
  const cfg = snap.services?.[slug];
  if (!cfg)
    throw new Error(`[httpClientBySlug] unknown service slug="${slug}"`);
  if (cfg.enabled !== true)
    throw new Error(`[httpClientBySlug] service "${slug}" is disabled`);
  return cfg as ServiceConfig;
}

/**
 * Perform an S2S request to a service by slug.
 * `path` is the service-local API path (e.g., "/resolve"); outboundApiPrefix is added from svcconfig.
 * Delegates the actual HTTP call to s2sRequest().
 */
export async function s2sRequestBySlug<TResp = unknown, TBody = unknown>(
  slug: string,
  apiVersion: string,
  path: string,
  opts: S2SRequestOptions<TBody> = {}
): Promise<S2SResponse<TResp>> {
  const key = `${slug}::${apiVersion || "-"}`;
  let apiBase = apiBaseCache.get(key);

  if (!apiBase) {
    const cfg = await resolveServiceConfig(slug);
    apiBase = computeApiBase(cfg);
    apiBaseCache.set(key, apiBase);
    logger.info(
      { slug, apiVersion, apiBase },
      "[httpClientBySlug] cached api base"
    );
  }

  const target = `${stripTrailing(apiBase)}${ensureLeading(path)}`;
  return s2sRequest<TResp, TBody>(target, opts);
}

/** Optional prewarm (safe to call multiple times). */
export async function prewarmSlug(
  slug: string,
  apiVersion: string
): Promise<void> {
  const key = `${slug}::${apiVersion || "-"}`;
  if (apiBaseCache.has(key)) return;
  const cfg = await resolveServiceConfig(slug);
  const apiBase = computeApiBase(cfg);
  apiBaseCache.set(key, apiBase);
  logger.info(
    { slug, apiVersion, apiBase },
    "[httpClientBySlug] prewarmed api base"
  );
}
