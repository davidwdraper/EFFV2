// backend/services/gateway/src/redis/client.ts
import { createClient, RedisClientType } from "redis";

let client: RedisClientType | null = null;

// Debounce noisy errors so we don't spam the console
const ERR_DEBOUNCE_MS = 5000;
let lastErrAt = 0;

function formatRedisError(err: unknown): string {
  const e = err as any;
  if (e?.errors && Array.isArray(e.errors) && e.errors.length) {
    const parts = e.errors.map((x: any) => x?.message || String(x));
    return `AggregateError: ${parts.join(" | ")}`;
  }
  return e?.message || String(e);
}

export function getRedis(): RedisClientType {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url || !url.trim()) {
    throw new Error("Missing required env var: REDIS_URL");
  }

  client = createClient({
    url: url.trim(),
    socket: {
      // reconnect strategy: back off quickly then cap at 1s
      reconnectStrategy(retries) {
        return Math.min(1000, Math.max(50, retries * 100));
      },
      keepAlive: true, // ✅ boolean, not number
      noDelay: true,
    },
  });

  client.on("ready", () => {
    console.error("[redis] ready");
  });

  client.on("error", (err) => {
    const now = Date.now();
    if (now - lastErrAt >= ERR_DEBOUNCE_MS) {
      lastErrAt = now;
      console.error("[redis] error:", formatRedisError(err));
    }
  });

  client.connect().catch((err) => {
    const now = Date.now();
    if (now - lastErrAt >= ERR_DEBOUNCE_MS) {
      lastErrAt = now;
      console.error("[redis] connect failed:", formatRedisError(err));
    }
  });

  return client;
}
