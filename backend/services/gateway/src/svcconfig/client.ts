// backend/services/gateway/src/svcconfig/client.ts
import axios from "axios";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "@shared/utils/logger";
import {
  SERVICECONFIG_URL,
  ROUTE_ALIAS,
  SVCCONFIG_POLL_MS,
  GATEWAY_FALLBACK_ENV_ROUTES,
} from "../config";

/** Shape stored in svcconfig DB (collection: service_configs) */
export type ServiceConfig = {
  slug: string;
  enabled: boolean;
  allowProxy: boolean;
  baseUrl: string;
  outboundApiPrefix?: string; // default: "/api"
  healthPath?: string; // default: "/health"
  exposeHealth?: boolean; // default: true
  protectedGetPrefixes?: string[];
  publicPrefixes?: string[];
  overrides?: {
    timeoutMs?: number;
    breaker?: {
      failureThreshold?: number;
      halfOpenAfterMs?: number;
      minRttMs?: number;
    };
    routeAliases?: Record<string, string>;
  };
  version: number;
  updatedAt?: string;
  updatedBy?: string;
  notes?: string;
};

const CACHE = new Map<string, ServiceConfig>(); // key = slug
const LKG_PATH =
  process.env.GATEWAY_SVCCONFIG_LKG_PATH ||
  path.resolve(__dirname, "../../.svcconfig.lkg.json");

// ── S2S mint (gateway → svcconfig) ───────────────────────────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim())
    throw new Error(`Missing required env var: ${name}`);
  return String(v).trim();
}
const S2S_SECRET = requireEnv("S2S_SECRET");
const S2S_ISSUER = requireEnv("S2S_ISSUER");
const S2S_AUDIENCE = requireEnv("S2S_AUDIENCE");

function mintS2S(ttlSec = 300): string {
  const now = Math.floor(Date.now() / 1000);
  // lazy require to avoid hard dep at import time
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");
  return jwt.sign(
    {
      sub: "s2s",
      iss: S2S_ISSUER,
      aud: S2S_AUDIENCE,
      iat: now,
      exp: now + ttlSec,
      jti: randomUUID(),
    },
    S2S_SECRET,
    { algorithm: "HS256" }
  );
}

// ── Low-level fetch/list ─────────────────────────────────────────────────────
async function fetchAll(): Promise<ServiceConfig[]> {
  const token = mintS2S(300);
  const r = await axios.get(`${SERVICECONFIG_URL}/api/svcconfig/services`, {
    timeout: 3000,
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });
  if (r.status >= 200 && r.status < 300 && Array.isArray(r.data)) {
    return r.data as ServiceConfig[];
  }
  throw new Error(`svcconfig list failed: ${r.status}`);
}

// ── Cache ops / LKG ──────────────────────────────────────────────────────────
async function writeLKG(items: ServiceConfig[]) {
  try {
    await fsp.writeFile(
      LKG_PATH,
      JSON.stringify({ v: 1, items }, null, 2),
      "utf8"
    );
  } catch {
    // best-effort; ignore
  }
}
async function readLKG(): Promise<ServiceConfig[] | null> {
  try {
    const raw = await fsp.readFile(LKG_PATH, "utf8");
    const parsed = JSON.parse(raw) as { v: number; items: ServiceConfig[] };
    if (parsed?.items && Array.isArray(parsed.items)) return parsed.items;
    return null;
  } catch {
    return null;
  }
}
function repopulate(items: ServiceConfig[]) {
  CACHE.clear();
  for (const it of items) {
    if (!it?.slug) continue;
    CACHE.set(it.slug.toLowerCase(), normalize(it));
  }
}
function normalize(it: ServiceConfig): ServiceConfig {
  return {
    ...it,
    slug: it.slug.toLowerCase(),
    outboundApiPrefix: it.outboundApiPrefix || "/api",
    healthPath: it.healthPath || "/health",
    exposeHealth: it.exposeHealth !== false,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function initializeSvcConfig(): Promise<void> {
  try {
    const items = await fetchAll();
    repopulate(items);
    await writeLKG(items);
    logger.info({ count: items.length }, "[gateway:svcconfig] loaded");
  } catch (err) {
    const lkg = await readLKG();
    if (lkg?.length) {
      repopulate(lkg);
      logger.warn({ count: lkg.length }, "[gateway:svcconfig] using LKG cache");
    } else {
      logger.error({ err }, "[gateway:svcconfig] initial load failed (no LKG)");
    }
  }
  // Fire-and-forget poller
  setInterval(async () => {
    try {
      const items = await fetchAll();
      repopulate(items);
      await writeLKG(items);
      logger.debug({ count: items.length }, "[gateway:svcconfig] poll refresh");
    } catch {
      // ignore; LKG remains
    }
  }, Math.max(3_000, SVCCONFIG_POLL_MS));
}

/** Resolve path segment → canonical slug (applies ROUTE_ALIAS, singularize naive) */
export function resolveSlug(seg: string): string {
  const lower = String(seg || "").toLowerCase();
  const aliased = ROUTE_ALIAS[lower] || lower;
  return aliased.endsWith("s") ? aliased.slice(0, -1) : aliased;
}

/** Get config by incoming path segment (with aliasing); returns undefined if absent/disabled */
export function getServiceBySegment(seg: string): ServiceConfig | undefined {
  const slug = resolveSlug(seg);
  const cfg = CACHE.get(slug);
  if (!cfg) return undefined;
  if (!cfg.enabled) return undefined;
  if (!cfg.allowProxy) return undefined;
  return cfg;
}

/** Get raw config by slug (no aliasing) */
export function getService(slug: string): ServiceConfig | undefined {
  return CACHE.get(String(slug || "").toLowerCase());
}

/** Compute the upstream base URL for data plane requests */
export function upstreamBaseFor(
  seg: string
): { base: string; apiPrefix: string } | null {
  const cfg = getServiceBySegment(seg);
  if (!cfg) return null;
  return {
    base: cfg.baseUrl.replace(/\/+$/, ""),
    apiPrefix: (cfg.outboundApiPrefix || "/api").replace(/^\/?/, "/"),
  };
}

/** Compute upstream health URL (if exposed) */
export function healthUrlFor(
  seg: string,
  kind: "live" | "ready"
): string | null {
  const cfg = getServiceBySegment(seg);
  if (!cfg || cfg.exposeHealth === false) return null;
  const healthRoot = (cfg.healthPath || "/health").replace(/\/+$/, "");
  return `${cfg.baseUrl.replace(/\/+$/, "")}${healthRoot}/${kind}`;
}

/** Whether legacy env routes are allowed (should be false in dev/prod) */
export function envFallbackAllowed(): boolean {
  return GATEWAY_FALLBACK_ENV_ROUTES === true;
}
