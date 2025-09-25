// backend/services/shared/svcconfig/client.ts
import axios from "axios";
import fsp from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import {
  SvcConfigSchema,
  type ServiceConfig,
} from "@eff/shared/src/contracts/svcconfig.contract";

// ──────────────────────────────────────────────────────────────────────────────
/**
 * ENV (same keys for both gateways)
 * Required:
 *   SVCCONFIG_BASE_URL         e.g., http://svcconfig:4015  (no trailing slash)
 *   S2S_JWT_SECRET
 *   S2S_JWT_ISSUER             e.g., "gateway" or "gateway-core"
 *   S2S_JWT_AUDIENCE           e.g., "internal-services"
 * Optional:
 *   SVCCONFIG_POLL_MS          default 0 (disabled). Set >0 to enable polling.
 *   SVCCONFIG_LKG_PATH         default: CWD/.lkg/svcconfig.json
 *   REDIS_URL                  enable hot updates via pub/sub
 *   SVCCONFIG_CHANNEL          default "svcconfig:changed"
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required env: ${name}`);
  return String(v).trim();
}

const BASE = requireEnv("SVCCONFIG_BASE_URL");
const S2S_SECRET = requireEnv("S2S_JWT_SECRET");
const S2S_ISSUER = requireEnv("S2S_JWT_ISSUER");
const S2S_AUDIENCE = requireEnv("S2S_JWT_AUDIENCE");

// Polling disabled by default; set >0 to enable
const POLL_MS = Math.max(0, Number(process.env.SVCCONFIG_POLL_MS ?? 0));

const LKG_PATH =
  process.env.SVCCONFIG_LKG_PATH ||
  path.resolve(process.cwd(), ".lkg/svcconfig.json");

const REDIS_URL = process.env.REDIS_URL || "";
const CHANNEL = process.env.SVCCONFIG_CHANNEL || "svcconfig:changed";

// ──────────────────────────────────────────────────────────────────────────────
// Types & in-memory state
export type SvcconfigSnapshot = {
  version: string; // local monotonic version
  updatedAt: number; // epoch ms of last refresh
  services: Record<string, ServiceConfig>; // keyed by slug (lowercase)
};

type State = {
  versionCounter: number;
  snapshot: SvcconfigSnapshot | null;
  lastFetchMs: number;
  source: "empty" | "cache" | "lkg";
};

const STATE: State = {
  versionCounter: 0,
  snapshot: null,
  lastFetchMs: 0,
  source: "empty",
};

// ──────────────────────────────────────────────────────────────────────────────
// S2S mint (caller identity = issuer)
export function mintS2S(ttlSec = 300): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: "s2s",
      iss: S2S_ISSUER,
      aud: S2S_AUDIENCE,
      iat: now,
      exp: now + ttlSec,
      jti: randomUUID(),
      svc: S2S_ISSUER,
    },
    S2S_SECRET,
    { algorithm: "HS256", noTimestamp: true }
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetch list from authority (svcconfig service)
function join(base: string, seg: string): string {
  const b = base.replace(/\/+$/, "");
  const s = seg.startsWith("/") ? seg : `/${seg}`;
  return `${b}${s}`;
}

async function fetchAll(): Promise<ServiceConfig[]> {
  // ⬇️ points at /api/svcconfig (list handler returns { items: [] })
  const url = join(BASE, "/api/svcconfig");
  const r = await axios.get(url, {
    timeout: 3000,
    headers: { Authorization: `Bearer ${mintS2S(300)}` },
    validateStatus: () => true,
  });

  if (
    !(r.status >= 200 && r.status < 300) ||
    !Array.isArray((r.data as any)?.items)
  ) {
    throw new Error(`svcconfig list failed: HTTP ${r.status}`);
  }

  const out: ServiceConfig[] = [];
  for (const raw of (r.data as any).items as unknown[]) {
    const p = SvcConfigSchema.safeParse(raw);
    if (p.success) {
      // enforce lowercase slug; other defaults handled by zod .default()
      out.push({ ...p.data, slug: p.data.slug.toLowerCase() });
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
function repopulate(items: ServiceConfig[]) {
  const services: Record<string, ServiceConfig> = {};
  for (const it of items) {
    if (!it?.slug) continue;
    services[it.slug.toLowerCase()] = it;
  }
  STATE.versionCounter++;
  STATE.snapshot = {
    version: String(STATE.versionCounter),
    updatedAt: Date.now(),
    services,
  };
  STATE.source = "cache";
  STATE.lastFetchMs = Date.now();
}

// ──────────────────────────────────────────────────────────────────────────────
// LKG helpers
export async function writeLKG(snapshot: SvcconfigSnapshot): Promise<void> {
  await fsp.mkdir(path.dirname(LKG_PATH), { recursive: true });
  await fsp.writeFile(
    LKG_PATH,
    JSON.stringify({ v: 1, snapshot }, null, 2),
    "utf8"
  );
}

export async function readLKG(): Promise<SvcconfigSnapshot | null> {
  try {
    const raw = await fsp.readFile(LKG_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      v: number;
      snapshot: SvcconfigSnapshot;
    };
    if (parsed?.snapshot && typeof parsed.snapshot.version === "string")
      return parsed.snapshot;
    return null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Public mirror API
export async function startSvcconfigMirror(): Promise<void> {
  // Initial fetch
  try {
    const items = await fetchAll();
    repopulate(items);
    try {
      await writeLKG(STATE.snapshot!);
    } catch {}
  } catch {
    // Try LKG if network fails
    const lkg = await readLKG();
    if (lkg) {
      STATE.snapshot = lkg;
      STATE.source = "lkg";
      STATE.lastFetchMs = Date.now();
    } else {
      STATE.snapshot = null;
      STATE.source = "empty";
      STATE.lastFetchMs = Date.now();
    }
  }

  // Redis hot updates (optional)
  if (REDIS_URL) {
    try {
      const { createClient } = await import("redis");
      const client = createClient({ url: REDIS_URL });
      await client.connect();
      await client.subscribe(CHANNEL, async (payload) => {
        console.info("[svcconfigClient] redis invalidation", {
          channel: CHANNEL,
          payload,
        });
        try {
          const items = await fetchAll();
          repopulate(items);
          try {
            await writeLKG(STATE.snapshot!);
          } catch {}
        } catch {
          // ignore; rely on next LKG or operator action
        }
      });
      client.on("error", () => {
        /* ignore; operator should notice Redis down */
      });
    } catch {
      // ignore; no Redis, no hot updates
    }
  }

  // Poll fallback — disabled unless POLL_MS > 0
  if (POLL_MS > 0) {
    console.info("[svcconfigClient] polling enabled", { intervalMs: POLL_MS });
    setInterval(async () => {
      try {
        const items = await fetchAll();
        repopulate(items);
        try {
          await writeLKG(STATE.snapshot!);
        } catch {}
      } catch {
        // ignore; keep last good snapshot/LKG
      }
    }, POLL_MS);
  } else {
    console.info("[svcconfigClient] polling disabled");
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
    ok: !!snap,
    source: STATE.source,
    version: snap?.version ?? null,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    services: snap ? Object.keys(snap.services) : [],
  };
}
