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

// ✅ Canonical shared contract
import {
  SvcConfigSchema,
  ServiceConfig,
} from "@shared/contracts/svcconfig.contract";

const CACHE = new Map<string, ServiceConfig>(); // key = slug
const LKG_PATH =
  process.env.GATEWAY_SVCCONFIG_LKG_PATH ||
  path.resolve(__dirname, "../../.svcconfig.lkg.json");

// ── internal cache versioning for ETag/snapshot ───────────────────────────────
let versionCounter = 0;
let lastUpdatedAtMs = 0;

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
  if (!(r.status >= 200 && r.status < 300) || !Array.isArray(r.data)) {
    throw new Error(`svcconfig list failed: ${r.status}`);
  }

  // Validate & normalize via shared Zod schema
  const out: ServiceConfig[] = [];
  for (const raw of r.data as unknown[]) {
    const parsed = SvcConfigSchema.safeParse(raw);
    if (parsed.success) {
      out.push(normalize(parsed.data));
    } else {
      logger.warn(
        { issues: parsed.error.issues },
        "[gateway:svcconfig] dropping invalid config item"
      );
    }
  }
  return out;
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
    const parsed = JSON.parse(raw) as { v: number; items: unknown[] };
    if (!parsed?.items || !Array.isArray(parsed.items)) return null;

    const out: ServiceConfig[] = [];
    for (const rawItem of parsed.items) {
      const p = SvcConfigSchema.safeParse(rawItem);
      if (p.success) out.push(normalize(p.data));
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function normalize(it: ServiceConfig): ServiceConfig {
  // The schema already defaults optional fields; just enforce lowercase slug.
  return {
    ...it,
    slug: it.slug.toLowerCase(),
    // (outboundApiPrefix/healthPath/exposeHealth already defaulted by Zod .default())
  };
}

function repopulate(items: ServiceConfig[]) {
  CACHE.clear();
  for (const it of items) {
    if (!it?.slug) continue;
    CACHE.set(it.slug.toLowerCase(), normalize(it));
  }
  // bump cache version + timestamp for ETag/snapshot semantics
  versionCounter++;
  lastUpdatedAtMs = Date.now();
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
      await writeLKG(lkg); // keep LKG shape consistent
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

/** Read-only snapshot for internal S2S mirror endpoints (ETag source = version) */
export function getSvcconfigSnapshot(): {
  version: string;
  updatedAt: number;
  services: Record<string, ServiceConfig>;
} | null {
  if (CACHE.size === 0) return null;
  const services: Record<string, ServiceConfig> = {};
  for (const [slug, cfg] of CACHE.entries()) services[slug] = cfg;
  return {
    version: String(versionCounter),
    updatedAt: lastUpdatedAtMs,
    services,
  };
}
