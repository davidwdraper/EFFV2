// backend/services/shared/utils/logger.ts
import axios from "axios";
import type { Request } from "express";
import pino, {
  type LoggerOptions,
  type LevelWithSilent,
  stdTimeFunctions,
} from "pino";
import fs from "node:fs"; // (kept for parity; fsp handles writes)
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getCallerInfo } from "../utils/logMeta";

/**
 * NowVibin — Shared Logger (authoritative)
 *
 * ❗️Each service MUST call `initLogger(SERVICE_NAME)` at bootstrap
 *    BEFORE creating any request loggers (e.g., pino-http).
 *
 * Usage:
 *   import { SERVICE_NAME } from "../utils/config";
 *   import { initLogger } from "@shared/utils/logger";
 *   initLogger(SERVICE_NAME);
 */

// ─────────────────────────── Env (fail fast for required) ─────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

const NODE_ENV = (process.env.NODE_ENV || "development").trim();
const IS_PROD = NODE_ENV === "production";

// Global, required everywhere
const LOG_LEVEL = requireEnv("LOG_LEVEL") as LevelWithSilent;
const LOG_SERVICE_URL = requireEnv("LOG_SERVICE_URL");

// FS sink is **optional** for non-log services.
// Only require LOG_FS_DIR if FS sink is enabled.
const SERVICE_NAME_ENV = (process.env.SERVICE_NAME || "").trim();
const LOG_CLIENT_DISABLE_FS =
  String(process.env.LOG_CLIENT_DISABLE_FS || "").toLowerCase() === "true";

// Enable FS sink if:
//   - not explicitly disabled, AND
//   - this is the log service (SERVICE_NAME=log) OR LOG_FS_DIR is explicitly provided
const SHOULD_ENABLE_FS_SINK =
  !LOG_CLIENT_DISABLE_FS &&
  (SERVICE_NAME_ENV === "log" || !!process.env.LOG_FS_DIR);

const LOG_FS_DIR = SHOULD_ENABLE_FS_SINK
  ? requireEnv("LOG_FS_DIR") // only required when FS sink is enabled
  : ""; // empty string ensures all FS helpers no-op

const LOG_SERVICE_TOKEN_CURRENT =
  process.env.LOG_SERVICE_TOKEN_CURRENT?.trim() || "";
const LOG_SERVICE_TOKEN_NEXT = process.env.LOG_SERVICE_TOKEN_NEXT?.trim() || "";

const LOG_ENABLE_INFO_DEBUG =
  String(process.env.LOG_ENABLE_INFO_DEBUG || "").toLowerCase() === "true";
const LOG_CACHE_MAX_MB = Number(process.env.LOG_CACHE_MAX_MB || 256);
const LOG_CACHE_MAX_DAYS = Number(process.env.LOG_CACHE_MAX_DAYS || 7); // reserved
const LOG_PING_INTERVAL_MS = Number(process.env.LOG_PING_INTERVAL_MS || 15_000);
const LOG_FLUSH_BATCH_SIZE = Number(process.env.LOG_FLUSH_BATCH_SIZE || 50); // reserved
const LOG_FLUSH_CONCURRENCY = Number(process.env.LOG_FLUSH_CONCURRENCY || 4); // reserved
const NOTIFY_STUB_ENABLED =
  String(process.env.NOTIFY_STUB_ENABLED || "").toLowerCase() === "true"; // reserved
const LOG_SERVICE_HEALTH_URL =
  (process.env.LOG_SERVICE_HEALTH_URL &&
    process.env.LOG_SERVICE_HEALTH_URL.trim()) ||
  deriveHealthUrl(LOG_SERVICE_URL);

// Validate level
const validLevels = new Set<LevelWithSilent>([
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
// NOTE: Avoid stamping "service":"unknown". Start with NO base.service.
//       After initLogger(), we recreate the logger with base.service set.
let SERVICE_NAME = ""; // set by initLogger()

const pinoOptions: LoggerOptions = {
  level: LOG_LEVEL,
  base: {}, // ← no "service" until initLogger() runs
  timestamp: stdTimeFunctions.isoTime,
  redact: {
    remove: true,
    paths: ["req.headers.authorization", "req.headers.cookie"],
  },
};

export let logger = pino(pinoOptions);

/** Initialize the shared logger for this running service. Call once at bootstrap. */
export function initLogger(serviceName: string): void {
  SERVICE_NAME = String(serviceName || "").trim();
  if (!SERVICE_NAME) throw new Error("initLogger requires serviceName");
  logger = pino({ ...pinoOptions, base: { service: SERVICE_NAME } });
}

/** Optional: expose current service name (after init) */
export function currentServiceName(): string {
  return SERVICE_NAME || "uninitialized";
}

/** Optional: set level dynamically (e.g., in tests) */
export function setLogLevel(level: LevelWithSilent) {
  if (!validLevels.has(level)) throw new Error(`Invalid LOG_LEVEL: "${level}"`);
  logger.level = level;
}

// ───────────────────────────── Request context helper ─────────────────────────
export function extractLogContext(req: Request): Record<string, any> {
  const hdrId =
    (req.headers["x-request-id"] as string | undefined) ||
    (req.headers["x-correlation-id"] as string | undefined) ||
    (req.headers["x-amzn-trace-id"] as string | undefined);
  return {
    requestId: (req as any).id || hdrId || null,
    path: req.originalUrl,
    method: req.method,
    userId: (req as any).user?._id || (req as any).user?.userId || null,
    entityId: req.params?.id,
    entityName: (req as any).entityName,
    ip: req.ip,
    service: SERVICE_NAME || undefined,
  };
}

// ─────────────────────────────── Types & Enrichment ───────────────────────────
export type AuditEvent = Record<string, any>;

function normalizeCaller(ci: any) {
  const c = ci || {};
  return {
    sourceFile: c.file || c.fileName || c.sourceFile || c.path,
    sourceLine: c.line || c.lineNumber || c.sourceLine,
    sourceFunction: c.functionName || c.func || c.method || c.name,
  };
}

function enrichEvent(e: AuditEvent): AuditEvent {
  const { sourceFile, sourceLine, sourceFunction } = normalizeCaller(
    getCallerInfo(3)
  );
  return {
    v: 1,
    eventId: e.eventId ?? randomUUID(),
    timeCreated: e.timeCreated ?? new Date().toISOString(),
    service: SERVICE_NAME || e.service,
    sourceFile: e.sourceFile ?? sourceFile,
    sourceLine: e.sourceLine ?? sourceLine,
    sourceFunction: e.sourceFunction ?? sourceFunction,
    ...e,
  };
}

// ───────────────────────────── Circuit breaker state ──────────────────────────
let breakerOpen = false;
let lastPingAt = 0;
let outageStartAt = 0;
let notifiedThisOutage = false;

function openBreaker() {
  breakerOpen = true;
  outageStartAt = outageStartAt || Date.now();
}
function closeBreaker() {
  breakerOpen = false;
  outageStartAt = 0;
  notifiedThisOutage = false;
}
function deriveHealthUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.origin}/health/deep`;
  } catch {
    return url;
  }
}

// ─────────────────────────────── Auth header helper ───────────────────────────
function authHeaders(prefer: "current" | "next") {
  const t =
    prefer === "current"
      ? LOG_SERVICE_TOKEN_CURRENT || LOG_SERVICE_TOKEN_NEXT
      : LOG_SERVICE_TOKEN_NEXT || LOG_SERVICE_TOKEN_CURRENT;
  if (!t) throw new Error("No token");
  return { "content-type": "application/json", "x-internal-key": t };
}

// ─────────────────────────────── LogSvc clients ───────────────────────────────
async function postToLogSvc(event: AuditEvent) {
  const payload = enrichEvent(event);
  try {
    await axios.post(LOG_SERVICE_URL, payload, {
      timeout: 1500,
      headers: authHeaders("current"),
    });
  } catch (err: any) {
    if (
      (err?.response?.status === 401 || err?.response?.status === 403) &&
      LOG_SERVICE_TOKEN_NEXT &&
      LOG_SERVICE_TOKEN_NEXT !== LOG_SERVICE_TOKEN_CURRENT
    ) {
      await axios.post(LOG_SERVICE_URL, payload, {
        timeout: 1500,
        headers: authHeaders("next"),
      });
    } else throw err;
  }
}

async function deepPing() {
  try {
    if (Date.now() - lastPingAt < LOG_PING_INTERVAL_MS) return false;
    lastPingAt = Date.now();
    const r = await axios.get(LOG_SERVICE_HEALTH_URL, { timeout: 1500 });
    return (
      !!(r?.data && (r.data.ok === true || r.status === 200)) &&
      r?.data?.db?.connected !== false
    );
  } catch {
    return false;
  }
}

// ─────────────────────────────── FS cache helpers ─────────────────────────────
function dayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}
function fileFor(ch: "audit" | "error", d = new Date()) {
  return path.join(LOG_FS_DIR, `${ch}-${dayStr(d)}.log`);
}
async function ensureFsDir() {
  if (!LOG_FS_DIR) return;
  await fsp.mkdir(LOG_FS_DIR, { recursive: true });
}
async function safeReaddir(dir: string) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
async function currentCacheSizeMB() {
  if (!LOG_FS_DIR) return 0;
  let total = 0;
  for (const f of await safeReaddir(LOG_FS_DIR)) {
    if (!f.name.endsWith(".log") && !f.name.endsWith(".replay")) continue;
    try {
      total += (await fsp.stat(path.join(LOG_FS_DIR, f.name))).size;
    } catch {}
  }
  return total / (1024 * 1024);
}
async function pruneOldestIfNeeded() {
  if (!LOG_FS_DIR) return;
  const size = await currentCacheSizeMB();
  if (size <= LOG_CACHE_MAX_MB) return;
  const files = (await safeReaddir(LOG_FS_DIR)).map((f) =>
    path.join(LOG_FS_DIR, f.name)
  );
  for (const f of files) {
    try {
      await fsp.unlink(f);
    } catch {}
  }
}
async function appendNdjson(ch: "audit" | "error", ev: AuditEvent) {
  if (!LOG_FS_DIR) return;
  await ensureFsDir();
  await pruneOldestIfNeeded();
  await fsp.appendFile(
    fileFor(ch),
    JSON.stringify({ ...enrichEvent(ev), channel: ch }) + "\n",
    "utf8"
  );
}

// ─────────────────────────────── Routing sinks ────────────────────────────────
async function emitAudit(evts: AuditEvent[] | AuditEvent) {
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
    } catch {
      openBreaker();
      await appendNdjson("audit", ev);
    }
  }
}
async function emitError(evts: AuditEvent[] | AuditEvent) {
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
    } catch {
      openBreaker();
      await appendNdjson("error", ev);
    }
  }
}

// Flush cached files
async function flushFsCache() {
  if (!LOG_FS_DIR) return;
  await ensureFsDir();
  for (const f of (await safeReaddir(LOG_FS_DIR))
    .map((e) => e.name)
    .filter((n) => n.endsWith(".log"))) {
    try {
      const lines = (await fsp.readFile(path.join(LOG_FS_DIR, f), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      for (const ev of lines) await postToLogSvc(ev);
      await fsp.unlink(path.join(LOG_FS_DIR, f));
    } catch {}
  }
}

// ─────────────────────────────── Telemetry & API ──────────────────────────────
export function telemetry(
  level: "info" | "debug",
  msg: string,
  meta?: Record<string, any>
) {
  if (IS_PROD && !LOG_ENABLE_INFO_DEBUG) return;
  (logger as any)[level]?.(meta || {}, msg);
}

export async function postAudit(evts: AuditEvent[] | AuditEvent) {
  const arr = Array.isArray(evts) ? evts : [evts];
  const errs = arr.filter((e) => e?.channel === "error");
  const audits = arr.filter((e) => e?.channel !== "error");
  if (audits.length) void emitAudit(audits);
  if (errs.length) void emitError(errs);
}

export async function postAuditStrict(evts: AuditEvent[] | AuditEvent) {
  for (const e of Array.isArray(evts) ? evts : [evts]) await postToLogSvc(e);
}
