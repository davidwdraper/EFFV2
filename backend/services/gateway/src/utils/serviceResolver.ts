// backend/services/gateway/src/utils/serviceResolver.ts
//
// References:
// - NowVibin SOP v4 — “svcconfig is the canonical source; gateway is the only public edge”
// - This session — “Audit dispatch is INTERNAL (S2S), do not require allowProxy”
// - Prior gateway code — local svcconfig mirror already runs in-process
//
// Why:
// We need **two distinct resolution modes**:
//   1) Public proxy routing (/api/<slug>/...): requires { enabled: true, allowProxy: true }.
//   2) Internal S2S calls (audit/log/etc.): requires { enabled: true } only (no public exposure).
//
// This module first consults the **local svcconfig mirror** (fast, consistent), then
// falls back to **dev/test env overrides**, and lastly to an **optional fetch** from
// gateway-core (`GATEWAY_CORE_BASE_URL + SVCCONFIG_INTERNAL_PATH`) to pre-warm cache.
// We keep an in-memory cache to reduce lookups and avoid hot loops during boot.
//
// API:
//   primeServices({ event: "http://127.0.0.1:4999" })   // prewarm for tests
//   putService("event", "http://...")                   // update at runtime
//   resolvePublicBase("user")    -> string|undefined
//   resolveInternalBase("event") -> string|undefined
//   joinUrl("http://a", "/b")    -> "http://a/b"
//

import { logger as sharedLogger } from "@shared/utils/logger";
import {
  getSvcconfigSnapshot,
  type SvcconfigSnapshot,
} from "@shared/svcconfig/client";
import type { ServiceConfig } from "@shared/src/contracts/svcconfig.contract";
import { getInternalJson } from "./s2sClient";

const logger = sharedLogger.child({ svc: "gateway", mod: "serviceResolver" });

// In-memory cache of slug → baseUrl
const cache = new Map<string, string>();
let lastFetchOk = false;

// ── Public API ────────────────────────────────────────────────────────────────

export function primeServices(map: Record<string, string>) {
  for (const [slug, url] of Object.entries(map || {})) {
    if (slug && url) cache.set(slug.toLowerCase(), stripSlash(url));
  }
}

export function putService(slug: string, baseUrl: string) {
  if (!slug || !baseUrl) return;
  cache.set(slug.toLowerCase(), stripSlash(baseUrl));
}

/**
 * Resolve a base URL for **public** proxy use.
 * Requires svc { enabled: true, allowProxy: true }.
 */
export function resolvePublicBase(slug: string): string | undefined {
  const s = slug.toLowerCase();
  // 1) svcconfig mirror preferred
  const cfg = pickFromSnapshot(s);
  if (cfg && cfg.enabled === true && cfg.allowProxy === true) {
    return stripSlash(cfg.baseUrl);
  }
  // 2) cache/env fallback (dev-only): public proxy should not rely on this in prod
  return cachedOrEnv(s);
}

/**
 * Resolve a base URL for **internal** S2S calls.
 * Requires svc { enabled: true }, does NOT require allowProxy.
 */
export function resolveInternalBase(slug: string): string | undefined {
  const s = slug.toLowerCase();
  // 1) svcconfig mirror preferred
  const cfg = pickFromSnapshot(s);
  if (cfg && cfg.enabled === true) {
    return stripSlash(cfg.baseUrl);
  }
  // 2) cache/env fallback
  return cachedOrEnv(s);
}

/** Join base + path safely (ensures exactly one slash). */
export function joinUrl(base: string, path: string): string {
  const b = stripSlash(base);
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

// ── Internals ────────────────────────────────────────────────────────────────

function pickFromSnapshot(slug: string): ServiceConfig | undefined {
  const snap: SvcconfigSnapshot | null = getSvcconfigSnapshot();
  if (!snap) return undefined;
  return snap.services?.[slug];
}

function cachedOrEnv(slug: string): string | undefined {
  // 1) cache
  const hit = cache.get(slug);
  if (hit) return hit;

  // 2) ENV (dev-only convenience)
  const envKey = `${slug.toUpperCase()}_SERVICE_URL`;
  const envUrl = process.env[envKey] || legacyEnvFallback(slug);
  if (envUrl) {
    const u = stripSlash(envUrl);
    cache.set(slug, u);
    return u;
  }

  // 3) Optional fetch from gateway-core — pre-warm cache once (best-effort)
  //    This is mostly useful during very early boot when mirror isn’t ready.
  void prewarmFromCore().catch((err) => {
    if (lastFetchOk) {
      logger.warn({ err }, "svcconfig fetch failed (continuing with cache)");
    } else {
      logger.debug({ err }, "svcconfig fetch not available yet");
    }
  });

  return undefined;
}

async function prewarmFromCore(): Promise<void> {
  const base = process.env.GATEWAY_CORE_BASE_URL || "";
  const path =
    process.env.SVCCONFIG_INTERNAL_PATH || "/__internal/svcconfig/services";
  if (!base) return;

  const url = `${stripSlash(base)}${path.startsWith("/") ? path : `/${path}`}`;
  const { data, status } = await getInternalJson(url);
  if (!(status >= 200 && status < 300)) return;

  // Expect shape: { services: { [slug]: { baseUrl } } } OR plain { slug: { baseUrl } }
  const map: Record<string, any> =
    data?.services && typeof data.services === "object" ? data.services : data;

  if (map && typeof map === "object") {
    for (const [k, v] of Object.entries(map)) {
      const resolved =
        typeof v === "string"
          ? v
          : typeof (v as any)?.baseUrl === "string"
          ? (v as any).baseUrl
          : undefined;
      if (resolved) cache.set(k.toLowerCase(), stripSlash(resolved));
    }
    lastFetchOk = true;
  }
}

function stripSlash(s: string) {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function legacyEnvFallback(slug: string): string | undefined {
  // For historical env names like ACT_SERVICE_URL, GEO_SERVICE_URL, etc.
  const key = `${slug.toUpperCase()}_SERVICE_URL`;
  return process.env[key];
}
