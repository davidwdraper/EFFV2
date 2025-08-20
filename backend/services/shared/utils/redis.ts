// backend/services/shared/utils/redis.ts

import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;

export function getRedis(): RedisClientType {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error("Missing required env var: REDIS_URL");

  client = createClient({ url });

  client.on("error", (err) => {
    // Fail-open: log to stderr; services keep running even if Redis is unhappy
    // eslint-disable-next-line no-console
    console.error("[redis] error:", err?.message || String(err));
  });

  // Connect in background; callers MUST tolerate cache misses
  client.connect().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[redis] connect failed:", err?.message || String(err));
  });

  return client;
}
