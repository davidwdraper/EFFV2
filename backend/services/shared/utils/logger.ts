// backend/services/shared/utils/logger.ts
import axios from "axios";
import type { Request } from "express";
import pino, { type LoggerOptions, type LevelWithSilent } from "pino";
import { getCallerInfo } from "../../shared/utils/logMeta";

// ── Env enforcement (no fallbacks) ─────────────────────────────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

const LOG_LEVEL = requireEnv("LOG_LEVEL") as LevelWithSilent;
const LOG_SERVICE_URL = requireEnv("LOG_SERVICE_URL"); // e.g. http://localhost:4005/logs
const LOG_SERVICE_TOKEN_CURRENT = requireEnv("LOG_SERVICE_TOKEN_CURRENT"); // callers always send CURRENT

// Optional: bind service into base logs if present (no fallback value)
const SERVICE_NAME = process.env.SERVICE_NAME?.trim();

// Validate LOG_LEVEL against pino known levels (fail fast)
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
  throw new Error(
    `Invalid LOG_LEVEL: "${LOG_LEVEL}". Expected one of ${Array.from(
      validLevels
    ).join(", ")}`
  );
}

// ── Pino: runtime instrumentation only (stdout JSON) ───────────────────────────
// Redact secrets so audits pass and no tokens leak to stdout
const pinoOptions: LoggerOptions = {
  level: LOG_LEVEL,
  base: SERVICE_NAME ? { service: SERVICE_NAME } : undefined,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
      // Just in case anyone logs config/env-like blobs:
      "*.password",
      "*.secret",
      "*.token",
      "*.apiKey",
      "*.x-internal-key",
    ],
    remove: true,
  },
};
export const logger = pino(pinoOptions);

// ── Context helper (adds requestId; otherwise unchanged) ──────────────────────
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
  };
}

// ── Optional shim for legacy call-sites that used logger.log(...) ─────────────
export async function log(
  type: "error" | "warn" | "info" | "debug",
  message: string,
  meta: Record<string, any> = {}
) {
  const fn = (logger as any)[type] ?? logger.info.bind(logger);
  fn(meta, message);
}
export const error = (msg: string, meta?: Record<string, any>) =>
  logger.error(meta || {}, msg);
export const warn = (msg: string, meta?: Record<string, any>) =>
  logger.warn(meta || {}, msg);
export const info = (msg: string, meta?: Record<string, any>) =>
  logger.info(meta || {}, msg);
export const debug = (msg: string, meta?: Record<string, any>) =>
  logger.debug(meta || {}, msg);

// ── Audit client: explicit business events → Log service ───────────────────────
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
  // SERVICE_NAME tag helps filter audits by service in DB
  return {
    timeCreated: e.timeCreated ?? new Date().toISOString(),
    sourceFile: e.sourceFile ?? sourceFile,
    sourceLine: e.sourceLine ?? sourceLine,
    sourceFunction: e.sourceFunction ?? sourceFunction,
    service: SERVICE_NAME || e.service, // include if configured
    ...e,
  };
}

/**
 * Best-effort audit: fire-and-forget. Never throws.
 * Includes internal auth header for the Log service.
 */
export async function postAudit(events: AuditEvent[] | AuditEvent) {
  const arr = Array.isArray(events) ? events : [events];
  await Promise.allSettled(
    arr.map((e) =>
      axios.post(LOG_SERVICE_URL, enrichEvent(e), {
        timeout: 1500,
        headers: {
          "content-type": "application/json",
          "x-internal-key": LOG_SERVICE_TOKEN_CURRENT,
        },
        // Never forward client Authorization to the log service
        transformRequest: [
          (data, headers) => {
            if (headers && "authorization" in headers)
              delete (headers as any).authorization;
            return JSON.stringify(data);
          },
        ],
      })
    )
  );
}

/**
 * Strict audit: throws if the log service is unreachable or returns non-2xx.
 * Use when you must fail the caller request if auditing fails.
 */
export async function postAuditStrict(
  events: AuditEvent[] | AuditEvent
): Promise<void> {
  const arr = Array.isArray(events) ? events : [events];
  try {
    await Promise.all(
      arr.map((e) =>
        axios.post(LOG_SERVICE_URL, enrichEvent(e), {
          timeout: 2000,
          headers: {
            "content-type": "application/json",
            "x-internal-key": LOG_SERVICE_TOKEN_CURRENT,
          },
          transformRequest: [
            (data, headers) => {
              if (headers && "authorization" in headers)
                delete (headers as any).authorization;
              return JSON.stringify(data);
            },
          ],
          // axios throws on non-2xx by default
        })
      )
    );
  } catch (err: any) {
    const msg =
      (err?.response && `log service responded ${err.response.status}`) ||
      (err?.code && `log service error ${err.code}`) ||
      err?.message ||
      "log service request failed";
    throw new Error(`Audit logging failed: ${msg}`);
  }
}
