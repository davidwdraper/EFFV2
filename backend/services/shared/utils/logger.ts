// backend/services/shared/utils/logger.ts
import axios from "axios";
import type { Request } from "express";
import pino, { type LoggerOptions, type LevelWithSilent } from "pino";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getCallerInfo } from "../../shared/utils/logMeta";

// ─────────────────────────── Env (fail fast for required) ─────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}
const NODE_ENV = (process.env.NODE_ENV || "development").trim();
const IS_PROD = NODE_ENV === "production";
const LOG_LEVEL = requireEnv("LOG_LEVEL") as LevelWithSilent;
const LOG_SERVICE_URL = requireEnv("LOG_SERVICE_URL"); // e.g., http://localhost:4005/logs
const LOG_FS_DIR = requireEnv("LOG_FS_DIR"); // FS cache root (must exist & be writable)

// Tokens (rotation-aware)
const LOG_SERVICE_TOKEN_CURRENT =
  process.env.LOG_SERVICE_TOKEN_CURRENT?.trim() || "";
const LOG_SERVICE_TOKEN_NEXT = process.env.LOG_SERVICE_TOKEN_NEXT?.trim() || "";

// Optional / defaults
const SERVICE_NAME = process.env.SERVICE_NAME?.trim();
const LOG_ENABLE_INFO_DEBUG =
  String(process.env.LOG_ENABLE_INFO_DEBUG || "").toLowerCase() === "true";
const LOG_CACHE_MAX_MB = Number(process.env.LOG_CACHE_MAX_MB || 256);
const LOG_CACHE_MAX_DAYS = Number(process.env.LOG_CACHE_MAX_DAYS || 7);
const LOG_PING_INTERVAL_MS = Number(process.env.LOG_PING_INTERVAL_MS || 15_000);
const LOG_FLUSH_BATCH_SIZE = Number(process.env.LOG_FLUSH_BATCH_SIZE || 50);
const LOG_FLUSH_CONCURRENCY = Number(process.env.LOG_FLUSH_CONCURRENCY || 4);
const NOTIFY_STUB_ENABLED =
  String(process.env.NOTIFY_STUB_ENABLED || "").toLowerCase() === "true";
const NOTIFY_GRACE_MS = Number(process.env.NOTIFY_GRACE_MS || 300_000);
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
if (!validLevels.has(LOG_LEVEL)) {
  throw new Error(`Invalid LOG_LEVEL: "${LOG_LEVEL}"`);
}
// Ensure at least one token exists
if (!LOG_SERVICE_TOKEN_CURRENT && !LOG_SERVICE_TOKEN_NEXT) {
  throw new Error(
    "Missing required env var: LOG_SERVICE_TOKEN_CURRENT (or LOG_SERVICE_TOKEN_NEXT during rotation)"
  );
}

// ────────────────────────────── Pino (stdout only) ────────────────────────────
const pinoOptions: LoggerOptions = {
  level: LOG_LEVEL,
  base: SERVICE_NAME ? { service: SERVICE_NAME } : undefined,
  redact: {
    remove: true,
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-internal-key']",
      "req.headers['x-api-key']",
      "req.body.password",
      "req.body.token",
      "req.body.apiKey",
      "req.body.secret",
      "res.headers['set-cookie']",
      "res.headers['Set-Cookie']",
      "res.headers.cookie",
      "res.headers['x-internal-key']",
      "res.headers['x-api-key']",
      "err.config.headers.authorization",
      "err.config.headers['x-internal-key']",
      "err.response.headers['set-cookie']",
      "err.response.config.headers.authorization",
      "err.response.config.headers['x-internal-key']",
    ],
  },
};
export const logger = pino(pinoOptions);

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
    service: SERVICE_NAME,
  };
}

// ─────────────────────────────── Types & Enrichment ───────────────────────────
export type AuditEvent = Record<string, any>;
type CallerLike = Record<string, any>;

function normalizeCaller(ci: CallerLike | null | undefined) {
  const c = ci || {};
  const sourceFile =
    c.file ?? c.fileName ?? c.filename ?? c.sourceFile ?? c.path ?? c.source;
  const sourceLine =
    c.line ?? c.lineNumber ?? c.lineno ?? c.sourceLine ?? c.columnNumber;
  const sourceFunction =
    c.functionName ?? c.func ?? c.function ?? c.method ?? c.fn ?? c.name;
  return { sourceFile, sourceLine, sourceFunction };
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
  const now = Date.now();
  outageStartAt = outageStartAt || now;
}
function closeBreaker() {
  breakerOpen = false;
  outageStartAt = 0;
  notifiedThisOutage = false;
}

function deriveHealthUrl(logUrl: string): string {
  try {
    const u = new URL(logUrl);
    return `${u.origin}/health/deep`;
  } catch {
    return logUrl;
  }
}

// ─────────────────────────────── Auth header helper ───────────────────────────
function authHeaders(prefer: "current" | "next"): Record<string, string> {
  const token =
    prefer === "current"
      ? LOG_SERVICE_TOKEN_CURRENT || LOG_SERVICE_TOKEN_NEXT
      : LOG_SERVICE_TOKEN_NEXT || LOG_SERVICE_TOKEN_CURRENT;
  if (!token) throw new Error("No internal token available for Log Service");
  return {
    "content-type": "application/json",
    "x-internal-key": token,
  };
}

// ─────────────────────────────── LogSvc clients ───────────────────────────────
async function postToLogSvc(event: AuditEvent): Promise<void> {
  const payload = enrichEvent(event);

  // First try CURRENT (or NEXT if CURRENT missing), then on 401/403 retry with the other token once.
  try {
    await axios.post(LOG_SERVICE_URL, payload, {
      timeout: 1500,
      headers: authHeaders("current"),
      transformRequest: [
        (data, headers) => {
          if (headers && "authorization" in headers)
            delete (headers as any).authorization;
          return JSON.stringify(data);
        },
      ],
    });
    return;
  } catch (err: any) {
    const status = err?.response?.status;
    const canRetryWithNext =
      (status === 401 || status === 403) &&
      !!LOG_SERVICE_TOKEN_NEXT &&
      LOG_SERVICE_TOKEN_NEXT !== LOG_SERVICE_TOKEN_CURRENT;
    if (!canRetryWithNext) throw err;
    // Retry once with NEXT
    await axios.post(LOG_SERVICE_URL, payload, {
      timeout: 1500,
      headers: authHeaders("next"),
      transformRequest: [
        (data, headers) => {
          if (headers && "authorization" in headers)
            delete (headers as any).authorization;
          return JSON.stringify(data);
        },
      ],
    });
  }
}

async function deepPing(): Promise<boolean> {
  try {
    const now = Date.now();
    if (now - lastPingAt < LOG_PING_INTERVAL_MS) return false;
    lastPingAt = now;
    const r = await axios.get(LOG_SERVICE_HEALTH_URL, { timeout: 1500 });
    const ok = !!(r?.data && (r.data.ok === true || r.status === 200));
    const dbOk = r?.data?.db?.connected !== false;
    return ok && dbOk;
  } catch {
    return false;
  }
}

// ─────────────────────────────── FS cache helpers ─────────────────────────────
function dayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fileFor(channel: "audit" | "error", d = new Date()): string {
  return path.join(LOG_FS_DIR, `${channel}-${dayStr(d)}.log`);
}
async function ensureFsDir() {
  await fsp.mkdir(LOG_FS_DIR, { recursive: true });
}
async function safeReaddir(dir: string) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [] as fs.Dirent[];
  }
}
async function currentCacheSizeMB(): Promise<number> {
  const files = await safeReaddir(LOG_FS_DIR);
  let total = 0;
  for (const f of files) {
    if (!f.name.endsWith(".log") && !f.name.endsWith(".replay")) continue;
    try {
      const st = await fsp.stat(path.join(LOG_FS_DIR, f.name));
      total += st.size;
    } catch {}
  }
  return total / (1024 * 1024);
}
async function pruneOldestIfNeeded() {
  const maxMB = LOG_CACHE_MAX_MB;
  const maxDays = LOG_CACHE_MAX_DAYS;
  const entries = (await safeReaddir(LOG_FS_DIR))
    .filter((f) => f.name.endsWith(".log") || f.name.endsWith(".replay"))
    .map((f) => ({ name: f.name, full: path.join(LOG_FS_DIR, f.name) }));
  // Age prune
  const now = Date.now();
  for (const e of entries) {
    try {
      const st = await fsp.stat(e.full);
      const ageDays = (now - st.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > maxDays) await fsp.unlink(e.full);
    } catch {}
  }
  // Size prune
  let size = await currentCacheSizeMB();
  if (size <= maxMB) return;
  const withTimes: Array<{
    name: string;
    full: string;
    mtime: number;
    size: number;
  }> = [];
  for (const e of await safeReaddir(LOG_FS_DIR)) {
    const full = path.join(LOG_FS_DIR, e.name);
    if (!e.name.endsWith(".log") && !e.name.endsWith(".replay")) continue;
    try {
      const st = await fsp.stat(full);
      withTimes.push({ name: e.name, full, mtime: st.mtimeMs, size: st.size });
    } catch {}
  }
  withTimes.sort((a, b) => a.mtime - b.mtime);
  for (const e of withTimes) {
    try {
      await fsp.unlink(e.full);
      size -= e.size / (1024 * 1024);
      if (size <= maxMB) break;
    } catch {}
  }
}
async function appendNdjson(channel: "audit" | "error", event: AuditEvent) {
  await ensureFsDir();
  await pruneOldestIfNeeded();
  const line = JSON.stringify({ ...enrichEvent(event), channel }) + "\n";
  await fsp.appendFile(fileFor(channel), line, "utf8");
}

// Flush: rename *.log -> *.replay then stream and re-emit; keep failures
async function flushFsCache(): Promise<void> {
  const lock = path.join(LOG_FS_DIR, ".flush.lock");
  if (fs.existsSync(lock)) return;
  await ensureFsDir();
  await fsp.writeFile(lock, String(Date.now()), "utf8");
  try {
    const files = (await safeReaddir(LOG_FS_DIR))
      .map((d) => d.name)
      .filter(
        (n) =>
          n.endsWith(".log") &&
          (n.startsWith("audit-") || n.startsWith("error-"))
      )
      .sort();

    for (const name of files) {
      const full = path.join(LOG_FS_DIR, name);
      const replay = full.replace(/\.log$/, ".replay");
      try {
        await fsp.rename(full, replay);
      } catch {
        continue;
      }
      const channel = name.startsWith("audit-") ? "audit" : "error";
      const reader = fs.createReadStream(replay, { encoding: "utf8" });
      let buf = "";
      const kept: string[] = [];
      let inFlight = 0;
      const queue: AuditEvent[] = [];

      const sendOne = async (ev: AuditEvent) => {
        try {
          await postToLogSvc(ev);
        } catch {
          kept.push(JSON.stringify({ ...ev, channel }) + "\n");
        }
      };

      const maybeDrain = () => {
        while (queue.length && inFlight < LOG_FLUSH_CONCURRENCY) {
          const ev = queue.shift()!;
          inFlight++;
          sendOne(ev)
            .catch(() => {}) // handled in sendOne
            .finally(() => {
              inFlight--;
            });
        }
      };

      await new Promise<void>((resolve) => {
        reader.on("data", (chunk: string | Buffer) => {
          buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!line.trim()) continue;
            try {
              const ev = JSON.parse(line);
              queue.push(ev);
              if (queue.length >= LOG_FLUSH_BATCH_SIZE) {
                maybeDrain();
              }
            } catch {
              // malformed line: drop
            }
          }
          maybeDrain();
        });
        reader.on("end", () => {
          const checkDone = () => {
            if (queue.length === 0 && inFlight === 0) return resolve();
            setTimeout(checkDone, 25);
          };
          maybeDrain();
          checkDone();
        });
        reader.on("error", () => resolve());
      });

      if (kept.length) {
        try {
          await fsp.writeFile(full, kept.join(""), "utf8");
        } catch {}
      }
      try {
        await fsp.unlink(replay);
      } catch {}
    }
  } finally {
    try {
      await fsp.unlink(lock);
    } catch {}
  }
}

// ───────────────────────────── Notify stub (prod, after grace) ────────────────
function maybeNotifyStub(kind: "audit" | "error") {
  if (!IS_PROD || !NOTIFY_STUB_ENABLED) return;
  if (!outageStartAt) return;
  const downMs = Date.now() - outageStartAt;
  if (downMs >= NOTIFY_GRACE_MS && !notifiedThisOutage) {
    notifiedThisOutage = true;
    logger.warn(
      { kind, downMs },
      "NOTIFY_STUB: log service unavailable; FS fallback active"
    );
  }
}

// ───────────────────────────── Routing sinks (authoritative) ──────────────────
async function emitAudit(events: AuditEvent[] | AuditEvent): Promise<void> {
  const arr = Array.isArray(events) ? events : [events];
  for (const raw of arr) {
    const ev = { ...raw, channel: "audit", level: "audit" };
    try {
      if (breakerOpen) {
        const back = await deepPing();
        if (back) {
          closeBreaker();
          await postToLogSvc(ev);
          void flushFsCache();
          continue;
        }
      }
      await postToLogSvc(ev);
    } catch {
      openBreaker();
      await appendNdjson("audit", ev);
      maybeNotifyStub("audit");
      if (!IS_PROD) logger.info({ ev }, "audit fallback → fs");
    }
  }
}

async function emitError(events: AuditEvent[] | AuditEvent): Promise<void> {
  const arr = Array.isArray(events) ? events : [events];
  for (const raw of arr) {
    const ev = { ...raw, channel: "error", level: "error" };
    try {
      if (breakerOpen) {
        const back = await deepPing();
        if (back) {
          closeBreaker();
          await postToLogSvc(ev);
          void flushFsCache();
          continue;
        }
      }
      await postToLogSvc(ev);
      if (!IS_PROD) logger.error({ ev }, "request error");
    } catch {
      openBreaker();
      await appendNdjson("error", ev);
      maybeNotifyStub("error");
      if (!IS_PROD) logger.error({ ev }, "error fallback → fs");
    }
  }
}

// Telemetry (info/debug) → pino in dev/test; discard in prod unless enabled
export function telemetry(
  level: "info" | "debug",
  msg: string,
  meta?: Record<string, any>
) {
  if (IS_PROD && !LOG_ENABLE_INFO_DEBUG) return;
  (logger as any)[level]?.(meta || {}, msg);
}

// ───────────────────────── Public API (used by middlewares) ───────────────────
/**
 * Unified, fire-and-forget emitter used by middlewares.
 * If event.channel === "error" it routes to the error sink, else to audit sink.
 */
export async function postAudit(
  events: AuditEvent[] | AuditEvent
): Promise<void> {
  const arr = Array.isArray(events) ? events : [events];
  const errs = arr.filter((e) => e?.channel === "error");
  const audits = arr.filter((e) => e?.channel !== "error");
  if (audits.length) void emitAudit(audits);
  if (errs.length) void emitError(errs);
}

/**
 * Strict variant: throws on failure to reach LogSvc (no FS fallback).
 * Use sparingly (e.g., boot-time asserts).
 */
export async function postAuditStrict(
  events: AuditEvent[] | AuditEvent
): Promise<void> {
  const arr = Array.isArray(events) ? events : [events];
  for (const e of arr) {
    await postToLogSvc(e);
  }
}
