// backend/services/shared/utils/redis.ts
import { createClient } from "redis";
import { logger } from "./logger";

// Use the exact concrete client type from createClient()
type RedisClient = ReturnType<typeof createClient>;

// Test environments should never connect to Redis.
// Also allow a feature-flag to disable in any env.
const isDisabled = () =>
  process.env.NODE_ENV === "test" || process.env.REDIS_DISABLED === "1";

// Accept several common env names; all optional in dev/test.
const resolveRedisUrl = (): string | undefined =>
  process.env.REDIS_URL ||
  process.env.REDIS_URI ||
  (process.env.REDIS_HOST
    ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || "6379"}`
    : undefined);

// Singleton (lazily created)
let client: RedisClient | null = null;

// Throttle noisy error logs (e.g., when Redis is down)
let lastErrorLog = 0;
const shouldLogError = () => {
  const now = Date.now();
  if (now - lastErrorLog > 5_000) {
    lastErrorLog = now;
    return true;
  }
  return false;
};

/**
 * Obtain a connected Redis client, or `null` if disabled/unavailable.
 * - Never throws.
 * - Lazily connects when enabled & URL is configured.
 * - Quiet in dev/test when Redis isn't running or disabled.
 */
export async function getRedis(): Promise<RedisClient | null> {
  try {
    if (isDisabled()) return null;

    // Already have an open client
    if (client && (client as any).isOpen) return client;

    // If we had a previous client but it closed, drop it
    if (client && !(client as any).isOpen) {
      try {
        await client.quit();
      } catch {
        /* ignore */
      }
      client = null;
    }

    const url = resolveRedisUrl();
    if (!url) {
      // No URL configured → silently no-op (dev/test friendly)
      return null;
    }

    // Create new client lazily
    const c = createClient({
      url,
      socket: {
        // Quick, bounded backoff to avoid log storms
        reconnectStrategy: (retries) => Math.min(retries * 100, 1_000),
      },
      disableOfflineQueue: true,
    });

    // Attach lightweight listeners (throttled errors)
    c.on("error", (err) => {
      if (shouldLogError()) {
        logger.warn({ err }, "[redis] client error (muted/throttled)");
      }
    });
    c.on("connect", () => logger.info({ service: "redis" }, "[redis] connect"));
    c.on("ready", () => logger.info({ service: "redis" }, "[redis] ready"));
    c.on("end", () => logger.info({ service: "redis" }, "[redis] end"));

    try {
      await c.connect();
    } catch (err) {
      // Couldn't connect → keep things quiet and return null
      if (shouldLogError()) {
        logger.warn({ err }, "[redis] connect failed (returning null)");
      }
      try {
        await c.quit();
      } catch {
        /* ignore */
      }
      return null;
    }

    // Guard: if caller raced and set client, close this one
    if (client && (client as any).isOpen) {
      try {
        await c.quit();
      } catch {
        /* ignore */
      }
      return client;
    }

    client = c;
    return client;
  } catch {
    // Absolute last-resort safety: never throw from getRedis()
    return null;
  }
}

/**
 * Test-only helper to reset the singleton between specs.
 */
export async function __dangerouslyResetRedisForTests(): Promise<void> {
  try {
    if (client && (client as any).isOpen) {
      await client.quit();
    }
  } catch {
    /* ignore */
  } finally {
    client = null;
    lastErrorLog = 0;
  }
}
