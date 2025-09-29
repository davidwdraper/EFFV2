// backend/services/gateway/src/redis/client.ts
/**
 * Redis client (lazy, prod-safe)
 *
 * Docs / ADRs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR-0033: Centralized Env Loading + Deferred Config Reads & Plugin Init
 *
 * Notes:
 * - No import-time env assertions. We resolve REDIS_URL at first use.
 * - In production, REDIS_URL is REQUIRED and we throw if missing.
 * - In dev/docker, we default to redis://127.0.0.1:6379 if unset.
 * - keepAlive must be number|false (not boolean true).
 */

import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;
let didConnect = false;

function resolveRedisUrl(): string {
  const mode = String(process.env.NODE_ENV || "dev").toLowerCase();
  const url = (process.env.REDIS_URL || "").trim();

  if (url) return url;

  if (mode === "production") {
    throw new Error("Missing required env var: REDIS_URL");
  }

  // Dev/docker fallback to keep local DX smooth.
  return "redis://127.0.0.1:6379";
}

/**
 * getRedis — returns a singleton client.
 * Safe to call multiple times; connection is established once.
 * Commands will queue until the connection is ready.
 */
export function getRedis(): RedisClientType {
  if (client) return client;

  const url = resolveRedisUrl();

  client = createClient({
    url,
    socket: {
      keepAlive: 60, // enable TCP keep-alive with a 60s initial delay
      // You can add reconnectStrategy here if you want custom backoff.
    },
  });

  client.on("error", (err) => {
    // Log-only; callers should handle command-level failures.
    console.error("[redis] client error:", { message: err?.message });
  });

  // Fire-and-forget connect; node-redis will queue commands until ready.
  if (!didConnect) {
    didConnect = true;
    void client.connect();
  }

  return client;
}

/**
 * closeRedis — optional helper for tests/shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } finally {
      client = null;
      didConnect = false;
    }
  }
}
