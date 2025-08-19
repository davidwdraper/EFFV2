import axios from "axios";
import type { Request } from "express";
import pino, { type LoggerOptions, type LevelWithSilent } from "pino";
import { getCallerInfo } from "../../shared/utils/logMeta";

// ── Env enforcement (no fallbacks) ─────────────────────────────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`Missing required env var: ${name}`);
  return v;
}

const LOG_LEVEL = requireEnv("LOG_LEVEL") as LevelWithSilent;
const LOG_SERVICE_URL = requireEnv("LOG_SERVICE_URL"); // e.g. http://log-service/log

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
const pinoOptions: LoggerOptions = {
  level: LOG_LEVEL,
  // No hooks: DB writes are explicit via postAudit()
};
export const logger = pino(pinoOptions);

// ── Context helper (unchanged behavior) ───────────────────────────────────────
export function extractLogContext(req: Request): Record<string, any> {
  return {
    path: req.originalUrl,
    method: req.method,
    userId: (req as any).user?._id || (req as any).user?.userId,
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

// Normalize whatever getCallerInfo returns (.file/.line/.functionName variants)
// Normalize whatever getCallerInfo returns (.file/.line/.functionName variants)
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

/**
 * Controllers push to req.audit[]. app.ts flushes once per request by calling postAudit(req.audit).
 * Hard-fails only on missing env at startup; individual POST failures do not throw.
 */
export async function postAudit(events: AuditEvent[] | AuditEvent) {
  const arr = Array.isArray(events) ? events : [events];

  const enrich = (e: AuditEvent) => {
    const { sourceFile, sourceLine, sourceFunction } = normalizeCaller(
      getCallerInfo(3)
    );
    return {
      timeCreated: e.timeCreated ?? new Date().toISOString(),
      sourceFile: e.sourceFile ?? sourceFile,
      sourceLine: e.sourceLine ?? sourceLine,
      sourceFunction: e.sourceFunction ?? sourceFunction,
      ...e,
    };
  };

  // Fire-and-forget; do not crash request flow if log service is unavailable
  await Promise.allSettled(
    arr.map((e) => axios.post(LOG_SERVICE_URL, enrich(e), { timeout: 1500 }))
  );
}
