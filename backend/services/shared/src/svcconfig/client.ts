/**
 * NowVibin — Shared
 * File: backend/services/shared/src/svcconfig/client.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *   - docs/adr/0036-single-s2s-client-kms-only-callBySlug.md
 *
 * Purpose
 * - Provide an in-process svcconfig snapshot mirror used by gateway + workers.
 * - Start **gracefully** even if no authority or LKG is present:
 *     1) If an authority URL is provided, fetch from it.
 *     2) Else, load from LKG (Last Known Good).
 *     3) Else, start with an EMPTY snapshot (routes will 502 “unknown slug”),
 *        but the process **does not crash**. Operators can seed LKG or bring up
 *        authority and hot-update via Redis.
 *
 * Contract
 * - No mandatory SVCCONFIG_BASE_URL.
 * - No hidden fallbacks or import-time crashes.
 * - Optional Redis hot updates; payload must provide data (we never fetch “because Redis said so”).
 */

import fsp from "node:fs/promises";
import path from "node:path";
import {
  SvcConfigSchema,
  type SvcConfig,
} from "../contracts/svcconfig.contract";

const LKG_PATH =
  process.env.SVCCONFIG_LKG_PATH ||
  path.resolve(process.cwd(), ".lkg/svcconfig.json");
const REDIS_URL = (process.env.REDIS_URL || "").trim();
const CHANNEL = process.env.SVCCONFIG_CHANNEL || "svcconfig:changed";

// Optional authority (HTTP). If omitted, we never perform HTTP.
const AUTH_BASE = (process.env.SVCCONFIG_BASE_URL || "").trim();
const AUTH_LIST_PATH = process.env.SVCCONFIG_LIST_PATH || "";
const AUTH_CANDIDATES = [
  "/api/svcconfig",
  "/svcconfig",
  "/api/config",
  "/api/services",
  "/snapshot",
  "/api/snapshot",
];

const joinUrl = (b: string, s: string) =>
  `${b.replace(/\/+$/, "")}${s.startsWith("/") ? s : `/${s}`}`;

// ── State
export type SvcconfigSnapshot = {
  version: string;
  updatedAt: number;
  services: Record<string, SvcConfig>;
};
type State = {
  versionCounter: number;
  snapshot: SvcconfigSnapshot | null;
  lastRefreshMs: number;
  source: "empty" | "lkg" | "authority" | "redis";
};
const STATE: State = {
  versionCounter: 0,
  snapshot: null,
  lastRefreshMs: 0,
  source: "empty",
};

// ── Coercion
function mapServices(obj: Record<string, unknown>): Record<string, SvcConfig> {
  const out: Record<string, SvcConfig> = {};
  for (const v of Object.values(obj)) {
    const p = SvcConfigSchema.safeParse(v);
    if (!p.success || !p.data?.slug) continue;
    const slug = String(p.data.slug).toLowerCase();
    out[slug] = { ...p.data, slug };
  }
  return out;
}
function coerceItemsToServices(items: unknown): Record<string, SvcConfig> {
  if (!Array.isArray(items)) return {};
  const out: Record<string, SvcConfig> = {};
  for (const raw of items) {
    const p = SvcConfigSchema.safeParse(raw);
    if (p.success && p.data?.slug) {
      const slug = String(p.data.slug).toLowerCase();
      out[slug] = { ...p.data, slug };
    }
  }
  return out;
}
function coerceAnyToServices(parsed: any): Record<string, SvcConfig> {
  if (parsed?.snapshot?.services)
    return Array.isArray(parsed.snapshot.services)
      ? coerceItemsToServices(parsed.snapshot.services)
      : mapServices(parsed.snapshot.services);
  if (parsed?.services)
    return Array.isArray(parsed.services)
      ? coerceItemsToServices(parsed.services)
      : mapServices(parsed.services);
  if (Array.isArray(parsed?.items)) return coerceItemsToServices(parsed.items);
  if (Array.isArray(parsed)) return coerceItemsToServices(parsed);
  return {};
}

// ── Persistence
async function writeLKG(snapshot: SvcconfigSnapshot): Promise<void> {
  await fsp.mkdir(path.dirname(LKG_PATH), { recursive: true });
  await fsp.writeFile(
    LKG_PATH,
    JSON.stringify({ v: 1, snapshot }, null, 2),
    "utf8"
  );
}
async function readLKG(): Promise<SvcconfigSnapshot | null> {
  try {
    const raw = await fsp.readFile(LKG_PATH, "utf8");
    const parsed = JSON.parse(raw) as any;
    const services = coerceAnyToServices(parsed);
    if (!services || Object.keys(services).length === 0) return null;
    return {
      version: String(parsed?.version ?? 0),
      updatedAt: Date.now(),
      services,
    };
  } catch {
    return null;
  }
}
function repopulateFromServices(
  services: Record<string, SvcConfig>,
  source: State["source"]
) {
  STATE.versionCounter++;
  STATE.snapshot = {
    version: String(STATE.versionCounter),
    updatedAt: Date.now(),
    services,
  };
  STATE.lastRefreshMs = Date.now();
  STATE.source = source;
}
function repopulateEmpty() {
  STATE.versionCounter++;
  STATE.snapshot = {
    version: String(STATE.versionCounter),
    updatedAt: Date.now(),
    services: {},
  };
  STATE.lastRefreshMs = Date.now();
  STATE.source = "empty";
}

// ── Optional authority
async function fetchFromAuthority(): Promise<Record<string, SvcConfig> | null> {
  if (!AUTH_BASE) return null;
  try {
    const { default: axios } = await import("axios");
    const endpoints = AUTH_LIST_PATH ? [AUTH_LIST_PATH] : AUTH_CANDIDATES;
    for (const ep of endpoints) {
      const url = joinUrl(AUTH_BASE, ep);
      try {
        const r = await axios.get(url, {
          timeout: 3000,
          validateStatus: () => true,
        });
        if (r.status < 200 || r.status >= 300) continue;
        const services = coerceAnyToServices(r.data);
        if (Object.keys(services).length) {
          console.info("[svcconfigClient] authority discovered", {
            url,
            count: Object.keys(services).length,
          });
          return services;
        }
      } catch {
        /* try next */
      }
    }
    console.warn(
      "[svcconfigClient] authority reachable but no recognized endpoints",
      { base: AUTH_BASE }
    );
    return null;
  } catch {
    return null;
  }
}

// ── Public API
export async function startSvcconfigMirror(): Promise<void> {
  const fromAuth = await fetchFromAuthority();
  if (fromAuth) {
    repopulateFromServices(fromAuth, "authority");
    try {
      await writeLKG(STATE.snapshot!);
    } catch {}
  } else {
    const lkg = await readLKG();
    if (lkg) repopulateFromServices(lkg.services, "lkg");
    else {
      repopulateEmpty();
      console.warn(
        "[svcconfigClient] no authority and no LKG — starting with EMPTY snapshot"
      );
    }
  }

  if (REDIS_URL) {
    try {
      const { createClient } = await import("redis");
      const client = createClient({ url: REDIS_URL });
      await client.connect();
      await client.subscribe(CHANNEL, async (payload) => {
        try {
          const msg = JSON.parse(payload);
          const next = coerceAnyToServices(msg);
          if (!next || Object.keys(next).length === 0) {
            const maybe = await fetchFromAuthority();
            if (maybe && Object.keys(maybe).length) {
              repopulateFromServices(maybe, "authority");
              try {
                await writeLKG(STATE.snapshot!);
              } catch {}
            } else {
              console.warn(
                "[svcconfigClient] redis payload ignored (no services)"
              );
            }
            return;
          }
          repopulateFromServices(next, "redis");
          try {
            await writeLKG(STATE.snapshot!);
          } catch {}
        } catch (err) {
          console.warn("[svcconfigClient] redis update ignored", { err });
        }
      });
      client.on("error", (err) =>
        console.warn("[svcconfigClient] redis error", { err })
      );
      console.info("[svcconfigClient] redis subscription enabled", {
        channel: CHANNEL,
      });
    } catch (err) {
      console.warn(
        "[svcconfigClient] redis not available; hot updates disabled",
        { err: (err as Error)?.message || String(err) }
      );
    }
  } else {
    console.info("[svcconfigClient] redis disabled; static snapshot in use");
  }
}

export function getSvcconfigSnapshot(): SvcconfigSnapshot | null {
  return STATE.snapshot;
}

export function getSvcconfigReadiness() {
  const snap = STATE.snapshot;
  const now = Date.now();
  const ageMs = snap ? now - snap.updatedAt : Number.POSITIVE_INFINITY;
  return {
    ok: !!snap && Object.keys(snap.services).length > 0,
    source: STATE.source,
    version: snap?.version ?? null,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    services: snap ? Object.keys(snap.services) : [],
  };
}
