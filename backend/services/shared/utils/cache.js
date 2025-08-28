"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisGet = redisGet;
exports.redisSet = redisSet;
exports.cacheDel = cacheDel;
exports.cacheDelByPrefix = cacheDelByPrefix;
exports.invalidateNamespace = invalidateNamespace;
exports.cacheGet = cacheGet;
exports.invalidateOnSuccess = invalidateOnSuccess;
const redis_1 = require("./redis");
// ----------------- Low-level helpers (Promise-based) -----------------
async function redisGet(key) {
    const r = await (0, redis_1.getRedis)();
    if (!r || !r.isOpen)
        return null;
    return r.get(key);
}
async function redisSet(key, value, ttlSeconds) {
    const r = await (0, redis_1.getRedis)();
    if (!r || !r.isOpen)
        return;
    if (ttlSeconds && ttlSeconds > 0) {
        await r.set(key, value, { EX: ttlSeconds });
    }
    else {
        await r.set(key, value);
    }
}
async function cacheDel(key) {
    const r = await (0, redis_1.getRedis)();
    if (!r || !r.isOpen)
        return;
    const arr = Array.isArray(key) ? key : [key];
    if (arr.length)
        await r.del(arr);
}
async function cacheDelByPrefix(prefix) {
    const r = await (0, redis_1.getRedis)();
    if (!r || !r.isOpen)
        return;
    const match = `${prefix}*`;
    const it = r.scanIterator?.({ MATCH: match, COUNT: 200 });
    if (it && typeof it[Symbol.asyncIterator] === "function") {
        const batch = [];
        for await (const k of it) {
            batch.push(k);
            if (batch.length >= 200) {
                await r.del(batch);
                batch.length = 0;
            }
        }
        if (batch.length)
            await r.del(batch);
        return;
    }
    // Fallback — fine for dev/test
    try {
        const keys = await r.keys(match);
        if (keys.length)
            await r.del(keys);
    }
    catch {
        // ignore
    }
}
/**
 * Namespace-wide invalidation helper.
 * Example: invalidateNamespace("user") clears all keys starting with "user:".
 */
async function invalidateNamespace(namespace) {
    await cacheDelByPrefix(`${namespace}:`);
}
// ----------------- Key derivation -----------------
function stableQueryString(req) {
    const qp = new URLSearchParams();
    const q = req.query;
    Object.keys(q)
        .sort()
        .forEach((k) => {
        const v = q[k];
        if (Array.isArray(v))
            v.sort().forEach((vv) => qp.append(k, String(vv)));
        else if (v !== undefined && v !== null)
            qp.append(k, String(v));
    });
    const s = qp.toString();
    return s ? `?${s}` : "";
}
function makeKey(ns, req) {
    // Namespace + method + normalized path + stable query
    const base = `${ns}:${req.method}:${req.baseUrl || ""}${req.path}`;
    return `${base}${stableQueryString(req)}`;
}
function ttlFromEnv(envVar) {
    if (!envVar)
        return undefined;
    const raw = process.env[envVar];
    if (!raw)
        return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
// ----------------- Middleware API expected by your routes -----------------
/**
 * Cache GET responses for a namespace. TTL read from env var at runtime.
 * Usage in routes: cacheGet("act", "ACT_CACHE_TTL_SEC")
 */
function cacheGet(namespace, ttlEnvVar) {
    return (req, res, next) => {
        if (req.method !== "GET")
            return next();
        (async () => {
            const key = makeKey(namespace, req);
            const hit = await redisGet(key);
            if (hit) {
                // We store an envelope: { status, headers, body }
                try {
                    const env = JSON.parse(hit);
                    if (env.headers) {
                        for (const [h, v] of Object.entries(env.headers)) {
                            // avoid setting hop-by-hop headers
                            if (!/^connection$|^transfer-encoding$|^keep-alive$/i.test(h)) {
                                res.setHeader(h, v);
                            }
                        }
                    }
                    res.status(env.status || 200).send(env.body);
                    return;
                }
                catch {
                    // Fall through on parse error
                }
            }
            // Miss: capture response and cache after send if 2xx
            const send = res.send.bind(res);
            res.send = (body) => {
                try {
                    const status = res.statusCode;
                    if (status >= 200 && status < 300) {
                        const headers = {};
                        // capture a few safe headers
                        const keep = ["content-type", "cache-control", "etag"];
                        keep.forEach((h) => {
                            const v = res.getHeader(h);
                            if (typeof v === "string")
                                headers[h] = v;
                        });
                        const envelope = JSON.stringify({ status, headers, body });
                        void redisSet(key, envelope, ttlFromEnv(ttlEnvVar));
                    }
                }
                catch {
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
function invalidateOnSuccess(keyOrNamespace) {
    const arr = Array.isArray(keyOrNamespace) ? keyOrNamespace : [keyOrNamespace];
    const toPrefix = (k) => {
        if (k.includes("*"))
            return { isPrefix: true, value: k.slice(0, k.indexOf("*")) };
        // Treat bare namespace as prefix
        if (!k.includes(":"))
            return { isPrefix: true, value: `${k}:` };
        return { isPrefix: false, value: k };
    };
    return (handler) => {
        return (req, res, next) => {
            const done = async () => {
                res.removeListener("finish", done);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        for (const k of arr) {
                            const spec = toPrefix(k);
                            if (spec.isPrefix)
                                await cacheDelByPrefix(spec.value);
                            else
                                await cacheDel(spec.value);
                        }
                    }
                    catch {
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
