"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedis = getRedis;
exports.__dangerouslyResetRedisForTests = __dangerouslyResetRedisForTests;
// backend/services/shared/utils/redis.ts
const redis_1 = require("redis");
const logger_1 = require("@shared/utils/logger");
// Test environments should never connect to Redis.
// Also allow a feature-flag to disable in any env.
const isDisabled = () => process.env.NODE_ENV === "test" || process.env.REDIS_DISABLED === "1";
// Accept several common env names; all optional in dev/test.
const resolveRedisUrl = () => process.env.REDIS_URL ||
    process.env.REDIS_URI ||
    (process.env.REDIS_HOST
        ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || "6379"}`
        : undefined);
// Singleton (lazily created)
let client = null;
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
async function getRedis() {
    try {
        if (isDisabled())
            return null;
        // Already have an open client
        if (client && client.isOpen)
            return client;
        // If we had a previous client but it closed, drop it
        if (client && !client.isOpen) {
            try {
                await client.quit();
            }
            catch {
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
        const c = (0, redis_1.createClient)({
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
                logger_1.logger.warn({ err }, "[redis] client error (muted/throttled)");
            }
        });
        c.on("connect", () => logger_1.logger.info({ service: "redis" }, "[redis] connect"));
        c.on("ready", () => logger_1.logger.info({ service: "redis" }, "[redis] ready"));
        c.on("end", () => logger_1.logger.info({ service: "redis" }, "[redis] end"));
        try {
            await c.connect();
        }
        catch (err) {
            // Couldn't connect → keep things quiet and return null
            if (shouldLogError()) {
                logger_1.logger.warn({ err }, "[redis] connect failed (returning null)");
            }
            try {
                await c.quit();
            }
            catch {
                /* ignore */
            }
            return null;
        }
        // Guard: if caller raced and set client, close this one
        if (client && client.isOpen) {
            try {
                await c.quit();
            }
            catch {
                /* ignore */
            }
            return client;
        }
        client = c;
        return client;
    }
    catch {
        // Absolute last-resort safety: never throw from getRedis()
        return null;
    }
}
/**
 * Test-only helper to reset the singleton between specs.
 */
async function __dangerouslyResetRedisForTests() {
    try {
        if (client && client.isOpen) {
            await client.quit();
        }
    }
    catch {
        /* ignore */
    }
    finally {
        client = null;
        lastErrorLog = 0;
    }
}
