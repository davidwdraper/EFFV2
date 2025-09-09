// backend/services/gateway/src/utils/serviceResolver.ts
//
// Service Resolver for gateway → worker routing
// - Primary source: svcconfig (fetched and cached)
// - Fallback: ENV per-service URLs (DEV ONLY; avoids boot deadlocks)
// - No axios/fetch here — all HTTP goes through utils/s2sClient.ts
//
// Env (optional, for bootstrap/fallback):
//   SVCCONFIG_INTERNAL_PATH=/__internal/svcconfig/services
//   GATEWAY_CORE_BASE_URL=http://127.0.0.1:4011     (if you want to fetch from core)
//   // Dev-only per-service fallbacks (discouraged, but practical while wiring):
//   USER_SERVICE_URL=http://127.0.0.1:4001
//   ACT_SERVICE_URL=http://127.0.0.1:4002
//   PLACE_SERVICE_URL=http://127.0.0.1:4003
//   EVENT_SERVICE_URL=http://127.0.0.1:4999
//
// API:
//   await getServiceBaseUrl("event") -> "http://127.0.0.1:4999"
//   primeServices({ event: "http://..." })  // optional pre-warm (tests/boot)
//   putService("event", "http://...")       // runtime update after hot reloads

import { getInternalJson } from "./s2sClient";
import { logger as sharedLogger } from "@shared/utils/logger";

const logger = sharedLogger.child({ svc: "gateway", mod: "serviceResolver" });

// In-memory cache of slug → baseUrl
const cache = new Map<string, string>();
let lastFetchOk = false;

export function primeServices(map: Record<string, string>) {
  for (const [slug, url] of Object.entries(map || {})) {
    if (slug && url) cache.set(slug, url);
  }
}

export function putService(slug: string, baseUrl: string) {
  if (!slug || !baseUrl) return;
  cache.set(slug, baseUrl);
}

export async function getServiceBaseUrl(slug: string): Promise<string> {
  if (!slug) throw new Error("serviceResolver: slug is required");

  // 1) Cache hit
  const hit = cache.get(slug);
  if (hit) return hit;

  // 2) DEV fallback via ENV (keeps you moving when svcconfig isn’t wired yet)
  const envKey = `${slug.toUpperCase()}_SERVICE_URL`;
  const envUrl = process.env[envKey] || legacyEnvFallback(slug);
  if (envUrl) {
    cache.set(slug, envUrl);
    return envUrl;
  }

  // 3) Fetch svcconfig (if configured)
  const base = process.env.GATEWAY_CORE_BASE_URL || ""; // or leave empty to skip
  const path =
    process.env.SVCCONFIG_INTERNAL_PATH || "/__internal/svcconfig/services";
  if (base) {
    try {
      const url = `${stripSlash(base)}${path}`;
      const { data } = await getInternalJson(url);
      // Expecting shape: { services: { [slug]: { baseUrl: string, ... } } } OR plain map
      const map: Record<string, any> =
        data?.services && typeof data.services === "object"
          ? data.services
          : data;

      if (map && typeof map === "object") {
        for (const [k, v] of Object.entries(map)) {
          const resolved =
            typeof v === "string"
              ? v
              : typeof (v as any)?.baseUrl === "string"
              ? (v as any).baseUrl
              : undefined;
          if (resolved) cache.set(k, resolved);
        }
        lastFetchOk = true;
        const found = cache.get(slug);
        if (found) return found;
      }
    } catch (err) {
      if (lastFetchOk) {
        logger.warn({ err }, "svcconfig fetch failed (continuing with cache)");
      } else {
        logger.debug({ err }, "svcconfig fetch not available yet");
      }
    }
  }

  throw new Error(`serviceResolver: no base URL for slug "${slug}"`);
}

function stripSlash(s: string) {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function legacyEnvFallback(slug: string): string | undefined {
  // For historical env names like ACT_SERVICE_URL, GEO_SERVICE_URL, etc.
  const key = `${slug.toUpperCase()}_SERVICE_URL`;
  return process.env[key];
}
