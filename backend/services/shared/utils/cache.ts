// backend/services/shared/utils/cache.ts
import type { Request, Response, RequestHandler } from "express";
import { getRedis } from "./redis";

// ----------------- Low-level helpers (Promise-based) -----------------

export async function redisGet(key: string): Promise<string | null> {
  const r = await getRedis();
  if (!r || !(r as any).isOpen) return null;
  return r.get(key);
}

export async function redisSet(
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<void> {
  const r = await getRedis();
  if (!r || !(r as any).isOpen) return;
  if (ttlSeconds && ttlSeconds > 0) {
    await r.set(key, value, { EX: ttlSeconds });
  } else {
    await r.set(key, value);
  }
}

export async function cacheDel(key: string | string[]): Promise<void> {
  const r = await getRedis();
  if (!r || !(r as any).isOpen) return;
  const arr = Array.isArray(key) ? key : [key];
  if (arr.length) await r.del(arr);
}

export async function cacheDelByPrefix(prefix: string): Promise<void> {
  const r = await getRedis();
  if (!r || !(r as any).isOpen) return;

  const match = `${prefix}*`;
  const it = (r as any).scanIterator?.({ MATCH: match, COUNT: 200 });

  if (it && typeof it[Symbol.asyncIterator] === "function") {
    const batch: string[] = [];
    for await (const k of it as AsyncIterable<string>) {
      batch.push(k);
      if (batch.length >= 200) {
        await r.del(batch);
        batch.length = 0;
      }
    }
    if (batch.length) await r.del(batch);
    return;
  }

  // Fallback — fine for dev/test
  try {
    const keys = await r.keys(match);
    if (keys.length) await r.del(keys);
  } catch {
    // ignore
  }
}

/**
 * Namespace-wide invalidation helper.
 * Example: invalidateNamespace("user") clears all keys starting with "user:".
 */
export async function invalidateNamespace(namespace: string): Promise<void> {
  await cacheDelByPrefix(`${namespace}:`);
}

// ----------------- Key derivation -----------------

function stableQueryString(req: Request): string {
  const qp = new URLSearchParams();
  const q = req.query as Record<string, any>;
  Object.keys(q)
    .sort()
    .forEach((k) => {
      const v = q[k];
      if (Array.isArray(v)) v.sort().forEach((vv) => qp.append(k, String(vv)));
      else if (v !== undefined && v !== null) qp.append(k, String(v));
    });
  const s = qp.toString();
  return s ? `?${s}` : "";
}

function makeKey(ns: string, req: Request): string {
  // Namespace + method + normalized path + stable query
  const base = `${ns}:${req.method}:${req.baseUrl || ""}${req.path}`;
  return `${base}${stableQueryString(req)}`;
}

function ttlFromEnv(envVar?: string): number | undefined {
  if (!envVar) return undefined;
  const raw = process.env[envVar];
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ----------------- Middleware API expected by your routes -----------------

/**
 * Cache GET responses for a namespace. TTL read from env var at runtime.
 * Usage in routes: cacheGet("act", "ACT_CACHE_TTL_SEC")
 */
export function cacheGet(
  namespace: string,
  ttlEnvVar?: string
): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET") return next();

    (async () => {
      const key = makeKey(namespace, req);
      const hit = await redisGet(key);

      if (hit) {
        // We store an envelope: { status, headers, body }
        try {
          const env = JSON.parse(hit) as {
            status: number;
            headers?: Record<string, string>;
            body: any;
          };
          if (env.headers) {
            for (const [h, v] of Object.entries(env.headers)) {
              // avoid setting hop-by-hop headers
              if (!/^connection$|^transfer-encoding$|^keep-alive$/i.test(h)) {
                res.setHeader(h, v as any);
              }
            }
          }
          res.status(env.status || 200).send(env.body);
          return;
        } catch {
          // Fall through on parse error
        }
      }

      // Miss: capture response and cache after send if 2xx
      const send = res.send.bind(res);
      (res as any).send = (body: any) => {
        try {
          const status = res.statusCode;
          if (status >= 200 && status < 300) {
            const headers: Record<string, string> = {};
            // capture a few safe headers
            const keep = ["content-type", "cache-control", "etag"];
            keep.forEach((h) => {
              const v = res.getHeader(h);
              if (typeof v === "string") headers[h] = v;
            });
            const envelope = JSON.stringify({ status, headers, body });
            void redisSet(key, envelope, ttlFromEnv(ttlEnvVar));
          }
        } catch {
          // ignore cache errors
        }
        return send(body);
      };

      next();
    })().catch(next);
  };
}

/**
 * Wrap a handler so that after a 2xx response it invalidates cache for the given key or namespace.
 * - If arg contains '*', treated as a pattern and we clear by prefix up to '*'.
 * - If arg has no ':' and no '*', it's treated as a **namespace** and we clear `${ns}:`.
 */
export function invalidateOnSuccess(
  keyOrNamespace: string | string[]
): (handler: RequestHandler) => RequestHandler {
  const arr = Array.isArray(keyOrNamespace) ? keyOrNamespace : [keyOrNamespace];

  const toPrefix = (k: string): { isPrefix: boolean; value: string } => {
    if (k.includes("*"))
      return { isPrefix: true, value: k.slice(0, k.indexOf("*")) };
    // Treat bare namespace as prefix
    if (!k.includes(":")) return { isPrefix: true, value: `${k}:` };
    return { isPrefix: false, value: k };
  };

  return (handler: RequestHandler): RequestHandler => {
    return (req, res, next) => {
      const done = async () => {
        res.removeListener("finish", done);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            for (const k of arr) {
              const spec = toPrefix(k);
              if (spec.isPrefix) await cacheDelByPrefix(spec.value);
              else await cacheDel(spec.value);
            }
          } catch {
            // best-effort only
          }
        }
      };

      // Always hook finish first
      res.on("finish", () => {
        void done();
      });

      // Properly chain async handlers so errors go to Express and don't hang
      Promise.resolve(handler(req, res, next)).catch(next);
    };
  };
}
