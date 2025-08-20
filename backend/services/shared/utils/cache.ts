// backend/services/shared/utils/cache.ts
import type { Request, RequestHandler } from "express";
import crypto from "crypto";
import { getRedis } from "./redis";
import { requireNumber } from "../config/env";

// Build a stable cache key from method, path, and **sorted** query params
function makeKey(namespace: string, req: Request): string {
  const url = req.originalUrl || req.url || "";
  const [path, q] = url.split("?", 2);
  let norm = path;
  if (q) {
    const params = new URLSearchParams(q);
    const entries = Array.from(params.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const qs = new URLSearchParams(entries).toString();
    norm = `${path}?${qs}`;
  }
  const raw = `${req.method} ${norm}`;
  const hash = crypto.createHash("sha1").update(raw).digest("hex");
  return `cache:${namespace}:${hash}`;
}

/**
 * GET response cache.
 * Reads TTL from the provided env var name (required; no defaults).
 * - Adds 'x-cache: HIT|MISS' header.
 * - Only caches 2xx JSON responses (res.json).
 * - Fails open if Redis is down.
 */
export function cacheGet(
  namespace: string,
  ttlEnvName: string
): RequestHandler {
  const redis = getRedis();
  const ttl = requireNumber(ttlEnvName);

  return async (req, res, next) => {
    if (req.method !== "GET") return next();

    const key = makeKey(namespace, req);

    try {
      const hit = await redis.get(key);
      if (hit) {
        res.setHeader("x-cache", "HIT");
        return res.json(JSON.parse(hit));
      }
    } catch {
      // fail-open
    }

    res.setHeader("x-cache", "MISS");
    const original = res.json.bind(res);
    (res as any).json = (body: any) => {
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          void redis.set(key, JSON.stringify(body), { EX: ttl });
        }
      } catch {
        // ignore cache write errors
      }
      return original(body);
    };

    next();
  };
}

/**
 * Invalidate all cached keys for a namespace using scanIterator + UNLINK (non-blocking).
 * Safe for dev and early prod; can be upgraded to key-tagging later.
 */
export async function invalidateNamespace(namespace: string): Promise<void> {
  const redis = getRedis();
  const pattern = `cache:${namespace}:*`;
  const batch: string[] = [];
  const BATCH_SIZE = 200;

  try {
    // node-redis v4 async iterator
    for await (const key of redis.scanIterator({
      MATCH: pattern,
      COUNT: 200,
    })) {
      batch.push(String(key));
      if (batch.length >= BATCH_SIZE) {
        // UNLINK is async/non-blocking server-side (prefer over DEL)
        // @ts-expect-error variadic unlink
        await redis.unlink(...batch);
        batch.length = 0;
      }
    }
    if (batch.length) {
      // @ts-expect-error variadic unlink
      await redis.unlink(...batch);
    }
  } catch {
    // fail-open on invalidation (cache can be stale; correctness will still be ok on next write)
  }
}

/**
 * Middleware that registers a post-response hook to invalidate the namespace
 * after successful mutations (POST/PUT/PATCH/DELETE with 2xx).
 */
export function invalidateOnSuccess(namespace: string): RequestHandler {
  return (req, res, next) => {
    const mutating = /^(POST|PUT|PATCH|DELETE)$/i.test(req.method);
    if (!mutating) return next();

    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void invalidateNamespace(namespace);
      }
    });

    next();
  };
}
