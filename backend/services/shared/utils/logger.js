"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.initLogger = initLogger;
exports.extractLogContext = extractLogContext;
exports.telemetry = telemetry;
exports.postAudit = postAudit;
exports.postAuditStrict = postAuditStrict;
// backend/services/shared/utils/logger.ts
const axios_1 = __importDefault(require("axios"));
const pino_1 = __importStar(require("pino"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const logMeta_1 = require("../../shared/utils/logMeta");
/**
 * NowVibin — Shared Logger (merged & authoritative)
 *
 * ❗️No more auto-discovery of SERVICE_NAME.
 * ✅ Each service MUST call `initLogger(SERVICE_NAME)` at bootstrap.
 *
 * Usage:
 *   import { SERVICE_NAME } from "./config";
 *   import { initLogger } from "@shared/utils/logger";
 *   initLogger(SERVICE_NAME);
 */
// ─────────────────────────── Env (fail fast for required) ─────────────────────
function requireEnv(name) {
    const v = process.env[name];
    if (!v || v.trim() === "")
        throw new Error(`Missing required env var: ${name}`);
    return v.trim();
}
const NODE_ENV = (process.env.NODE_ENV || "development").trim();
const IS_PROD = NODE_ENV === "production";
const LOG_LEVEL = requireEnv("LOG_LEVEL");
const LOG_SERVICE_URL = requireEnv("LOG_SERVICE_URL");
const LOG_FS_DIR = requireEnv("LOG_FS_DIR");
const LOG_SERVICE_TOKEN_CURRENT = process.env.LOG_SERVICE_TOKEN_CURRENT?.trim() || "";
const LOG_SERVICE_TOKEN_NEXT = process.env.LOG_SERVICE_TOKEN_NEXT?.trim() || "";
const LOG_ENABLE_INFO_DEBUG = String(process.env.LOG_ENABLE_INFO_DEBUG || "").toLowerCase() === "true";
const LOG_CACHE_MAX_MB = Number(process.env.LOG_CACHE_MAX_MB || 256);
const LOG_CACHE_MAX_DAYS = Number(process.env.LOG_CACHE_MAX_DAYS || 7);
const LOG_PING_INTERVAL_MS = Number(process.env.LOG_PING_INTERVAL_MS || 15000);
const LOG_FLUSH_BATCH_SIZE = Number(process.env.LOG_FLUSH_BATCH_SIZE || 50);
const LOG_FLUSH_CONCURRENCY = Number(process.env.LOG_FLUSH_CONCURRENCY || 4);
const NOTIFY_STUB_ENABLED = String(process.env.NOTIFY_STUB_ENABLED || "").toLowerCase() === "true";
const NOTIFY_GRACE_MS = Number(process.env.NOTIFY_GRACE_MS || 300000);
const LOG_SERVICE_HEALTH_URL = (process.env.LOG_SERVICE_HEALTH_URL &&
    process.env.LOG_SERVICE_HEALTH_URL.trim()) ||
    deriveHealthUrl(LOG_SERVICE_URL);
// Validate level
const validLevels = new Set([
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
    "silent",
]);
if (!validLevels.has(LOG_LEVEL))
    throw new Error(`Invalid LOG_LEVEL: "${LOG_LEVEL}"`);
if (!LOG_SERVICE_TOKEN_CURRENT && !LOG_SERVICE_TOKEN_NEXT) {
    throw new Error("Missing required log token");
}
// ────────────────────────────── Service name & Pino init ──────────────────────
let SERVICE_NAME = "unknown"; // set by initLogger()
const pinoOptions = {
    level: LOG_LEVEL,
    base: { service: SERVICE_NAME },
    timestamp: pino_1.stdTimeFunctions.isoTime,
    redact: {
        remove: true,
        paths: ["req.headers.authorization", "req.headers.cookie"],
    },
};
exports.logger = (0, pino_1.default)(pinoOptions);
function initLogger(serviceName) {
    SERVICE_NAME = String(serviceName || "").trim();
    if (!SERVICE_NAME)
        throw new Error("initLogger requires serviceName");
    exports.logger = (0, pino_1.default)({ ...pinoOptions, base: { service: SERVICE_NAME } });
}
// ───────────────────────────── Request context helper ─────────────────────────
function extractLogContext(req) {
    const hdrId = req.headers["x-request-id"] ||
        req.headers["x-correlation-id"] ||
        req.headers["x-amzn-trace-id"];
    return {
        requestId: req.id || hdrId || null,
        path: req.originalUrl,
        method: req.method,
        userId: req.user?._id || req.user?.userId || null,
        entityId: req.params?.id,
        entityName: req.entityName,
        ip: req.ip,
        service: SERVICE_NAME,
    };
}
function normalizeCaller(ci) {
    const c = ci || {};
    return {
        sourceFile: c.file || c.fileName || c.sourceFile || c.path,
        sourceLine: c.line || c.lineNumber || c.sourceLine,
        sourceFunction: c.functionName || c.func || c.method || c.name,
    };
}
function enrichEvent(e) {
    const { sourceFile, sourceLine, sourceFunction } = normalizeCaller((0, logMeta_1.getCallerInfo)(3));
    return {
        v: 1,
        eventId: e.eventId ?? (0, node_crypto_1.randomUUID)(),
        timeCreated: e.timeCreated ?? new Date().toISOString(),
        service: SERVICE_NAME || e.service,
        sourceFile: e.sourceFile ?? sourceFile,
        sourceLine: e.sourceLine ?? sourceLine,
        sourceFunction: e.sourceFunction ?? sourceFunction,
        ...e,
    };
}
// ───────────────────────────── Circuit breaker state ──────────────────────────
let breakerOpen = false, lastPingAt = 0, outageStartAt = 0, notifiedThisOutage = false;
function openBreaker() {
    breakerOpen = true;
    outageStartAt = outageStartAt || Date.now();
}
function closeBreaker() {
    breakerOpen = false;
    outageStartAt = 0;
    notifiedThisOutage = false;
}
function deriveHealthUrl(url) {
    try {
        const u = new URL(url);
        return `${u.origin}/health/deep`;
    }
    catch {
        return url;
    }
}
// ─────────────────────────────── Auth header helper ───────────────────────────
function authHeaders(prefer) {
    const t = prefer === "current"
        ? LOG_SERVICE_TOKEN_CURRENT || LOG_SERVICE_TOKEN_NEXT
        : LOG_SERVICE_TOKEN_NEXT || LOG_SERVICE_TOKEN_CURRENT;
    if (!t)
        throw new Error("No token");
    return { "content-type": "application/json", "x-internal-key": t };
}
// ─────────────────────────────── LogSvc clients ───────────────────────────────
async function postToLogSvc(event) {
    const payload = enrichEvent(event);
    try {
        await axios_1.default.post(LOG_SERVICE_URL, payload, {
            timeout: 1500,
            headers: authHeaders("current"),
        });
    }
    catch (err) {
        if ((err?.response?.status === 401 || err?.response?.status === 403) &&
            LOG_SERVICE_TOKEN_NEXT &&
            LOG_SERVICE_TOKEN_NEXT !== LOG_SERVICE_TOKEN_CURRENT) {
            await axios_1.default.post(LOG_SERVICE_URL, payload, {
                timeout: 1500,
                headers: authHeaders("next"),
            });
        }
        else
            throw err;
    }
}
async function deepPing() {
    try {
        if (Date.now() - lastPingAt < LOG_PING_INTERVAL_MS)
            return false;
        lastPingAt = Date.now();
        const r = await axios_1.default.get(LOG_SERVICE_HEALTH_URL, { timeout: 1500 });
        return (!!(r?.data && (r.data.ok === true || r.status === 200)) &&
            r?.data?.db?.connected !== false);
    }
    catch {
        return false;
    }
}
// ─────────────────────────────── FS cache helpers ─────────────────────────────
function dayStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fileFor(ch, d = new Date()) {
    return node_path_1.default.join(LOG_FS_DIR, `${ch}-${dayStr(d)}.log`);
}
async function ensureFsDir() {
    await promises_1.default.mkdir(LOG_FS_DIR, { recursive: true });
}
async function safeReaddir(dir) {
    try {
        return await promises_1.default.readdir(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
async function currentCacheSizeMB() {
    let total = 0;
    for (const f of await safeReaddir(LOG_FS_DIR)) {
        if (!f.name.endsWith(".log") && !f.name.endsWith(".replay"))
            continue;
        try {
            total += (await promises_1.default.stat(node_path_1.default.join(LOG_FS_DIR, f.name))).size;
        }
        catch { }
    }
    return total / (1024 * 1024);
}
async function pruneOldestIfNeeded() {
    let size = await currentCacheSizeMB();
    if (size <= LOG_CACHE_MAX_MB)
        return;
    const files = (await safeReaddir(LOG_FS_DIR)).map((f) => node_path_1.default.join(LOG_FS_DIR, f.name));
    for (const f of files) {
        try {
            await promises_1.default.unlink(f);
        }
        catch { }
    }
}
async function appendNdjson(ch, ev) {
    await ensureFsDir();
    await pruneOldestIfNeeded();
    await promises_1.default.appendFile(fileFor(ch), JSON.stringify({ ...enrichEvent(ev), channel: ch }) + "\n", "utf8");
}
// ─────────────────────────────── Routing sinks ────────────────────────────────
async function emitAudit(evts) {
    for (const raw of Array.isArray(evts) ? evts : [evts]) {
        const ev = { ...raw, channel: "audit" };
        try {
            if (breakerOpen && (await deepPing())) {
                closeBreaker();
                await postToLogSvc(ev);
                void flushFsCache();
                continue;
            }
            await postToLogSvc(ev);
        }
        catch {
            openBreaker();
            await appendNdjson("audit", ev);
        }
    }
}
async function emitError(evts) {
    for (const raw of Array.isArray(evts) ? evts : [evts]) {
        const ev = { ...raw, channel: "error" };
        try {
            if (breakerOpen && (await deepPing())) {
                closeBreaker();
                await postToLogSvc(ev);
                void flushFsCache();
                continue;
            }
            await postToLogSvc(ev);
        }
        catch {
            openBreaker();
            await appendNdjson("error", ev);
        }
    }
}
// Flush cached files
async function flushFsCache() {
    await ensureFsDir();
    for (const f of (await safeReaddir(LOG_FS_DIR))
        .map((e) => e.name)
        .filter((n) => n.endsWith(".log"))) {
        try {
            const lines = (await promises_1.default.readFile(node_path_1.default.join(LOG_FS_DIR, f), "utf8"))
                .split("\n")
                .filter(Boolean)
                .map((l) => JSON.parse(l));
            for (const ev of lines)
                await postToLogSvc(ev);
            await promises_1.default.unlink(node_path_1.default.join(LOG_FS_DIR, f));
        }
        catch { }
    }
}
// ─────────────────────────────── Telemetry & API ──────────────────────────────
function telemetry(level, msg, meta) {
    if (IS_PROD && !LOG_ENABLE_INFO_DEBUG)
        return;
    exports.logger[level]?.(meta || {}, msg);
}
async function postAudit(evts) {
    const arr = Array.isArray(evts) ? evts : [evts];
    const errs = arr.filter((e) => e?.channel === "error");
    const audits = arr.filter((e) => e?.channel !== "error");
    if (audits.length)
        void emitAudit(audits);
    if (errs.length)
        void emitError(errs);
}
async function postAuditStrict(evts) {
    for (const e of Array.isArray(evts) ? evts : [evts])
        await postToLogSvc(e);
}
