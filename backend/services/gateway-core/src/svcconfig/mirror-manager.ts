// backend/services/gateway-core/src/svcconfig/mirror-manager.ts
import type { SvcconfigSnapshot } from "./state";
import { setFromNetwork, setFromLkg, getEtag } from "./state";
import {
  fetchFull,
  writeLKG,
  readLKG,
  type FetchResult,
} from "./fetch-from-gateway";

// ─────────────────────────────────────────────────────────────────────────────
// Env (fail-fast for criticals; poll & redis optional)
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required env: ${name}`);
  return String(v).trim();
}

// Criticals used by fetch-from-gateway already validated there, but we validate
// optional mirror controls here:
const SVCCONFIG_CHANNEL = process.env.SVCCONFIG_CHANNEL || "svcconfig:changed";
const REDIS_URL =
  process.env.REDIS_URL || process.env.SVCCONFIG_REDIS_URL || "";
const POLL_MS = Math.max(
  10_000,
  Number(process.env.SVCCONFIG_POLL_MS || 10_000)
);

type RedisClient = {
  subscribe: (channel: string) => Promise<void>;
  on: (event: string, cb: (...args: any[]) => void) => void;
  disconnect: () => Promise<void>;
};

// Lazy holder so we don’t hard-require redis in environments without it
let redisClient: RedisClient | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Fetch + apply helpers

async function applyOk(result: Extract<FetchResult, { kind: "ok" }>) {
  setFromNetwork(result.snapshot, result.etag);
  // persist LKG best-effort
  try {
    await writeLKG(result.snapshot);
  } catch {
    // ignore LKG write failures
  }
}

async function tryFetchFull(tag: string | null) {
  const res = await fetchFull(tag);
  if (res.kind === "ok") {
    await applyOk(res);
    return { updated: true, etag: res.etag };
  }
  if (res.kind === "not-modified") {
    // still update last fetch time in state via setFromLkg with same snapshot? No need.
    return { updated: false, etag: res.etag };
  }
  // error: leave state as-is
  return { updated: false, etag: tag };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API

/**
 * Initialize the svcconfig mirror:
 *  - Try network fetch with If-None-Match (if we already had an ETag)
 *  - If network fails and no snapshot, try LKG
 *  - Optionally subscribe to Redis for hot refresh
 *  - Start poll fallback if Redis not configured
 */
export async function startSvcconfigMirror(): Promise<void> {
  // 1) Boot fetch
  const currentEtag = getEtag();
  const fetched = await tryFetchFull(currentEtag ?? null);

  if (!fetched.updated) {
    // If we still have no snapshot, attempt LKG
    const lkg = await readLKG().catch(() => null);
    if (lkg) {
      setFromLkg(lkg, currentEtag ?? `"v:${lkg.version}"`);
    } else {
      setFromLkg(null);
    }
  }

  // 2) Redis subscribe (best-effort)
  if (REDIS_URL) {
    try {
      // Dynamically import node-redis v4 to avoid hard dep in builds that don't need it
      const { createClient } = await import("redis");
      const client = createClient({ url: REDIS_URL });
      await client.connect();
      await client.subscribe(SVCCONFIG_CHANNEL, async (message: string) => {
        // On any message, attempt a refetch with current ETag
        void tryFetchFull(getEtag());
      });
      client.on("error", () => {
        // If Redis goes bad, we’ll rely on poll fallback
      });
      redisClient = client as unknown as RedisClient;
    } catch {
      // Redis optional — fall back to polling
    }
  }

  // 3) Poll fallback if no Redis client
  if (!redisClient) {
    setInterval(() => {
      void tryFetchFull(getEtag());
    }, POLL_MS);
  }
}

/** Expose a readiness view suitable for your health router */
export async function getSvcconfigReadiness() {
  // Delegate to state module; keep async signature for easy drop-in
  const mod = await import("./state");
  return mod.getReadiness();
}
