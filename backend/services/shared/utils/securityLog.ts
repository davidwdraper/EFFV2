// backend/services/shared/utils/securityLog.ts

/**
 * Docs:
 * - Design: docs/design/backend/security/SECURITY-TELEMETRY.md
 * - Architecture: docs/architecture/backend/SECURITY.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0011-global-edge-rate-limiting.md
 *   - docs/adr/0012-gateway-edge-timeouts.md
 *   - docs/adr/0013-segmented-circuit-breaker.md
 *
 * Why:
 * - Guardrail denials (auth gate, rate limit, timeouts, circuit breaker, etc.)
 *   are **security telemetry**, not billing events. They must **never** pollute
 *   the audit WAL. We ship them to LogSvc with channel="security" and, if the
 *   sink is down, optionally cache to FS as NDJSON for later operator review.
 *
 * Notes:
 * - Fire-and-forget: this must never block foreground traffic.
 * - Keeps payloads short, non-PII, and consistently shaped for dashboards.
 * - Uses the same token rollover pattern as the shared logger: try CURRENT token,
 *   on 401/403 retry with NEXT token.
 */

import type { Request } from "express";
import axios from "axios";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { currentServiceName, logger } from "./logger";

// ─────────────────────────── Env (fail-fast where it matters) ─────────────────
const LOG_SERVICE_URL = (process.env.LOG_SERVICE_URL || "").trim();
if (!LOG_SERVICE_URL) {
  // We don't throw here because services may boot before secrets mount in dev,
  // but we do warn loudly once so operators know SECURITY logs will be dropped.
  logger.warn({
    msg: "LOG_SERVICE_URL not set; security telemetry will be dropped",
  });
}

const LOG_SERVICE_TOKEN_CURRENT = (
  process.env.LOG_SERVICE_TOKEN_CURRENT || ""
).trim();
const LOG_SERVICE_TOKEN_NEXT = (
  process.env.LOG_SERVICE_TOKEN_NEXT || ""
).trim();

const LOG_CLIENT_DISABLE_FS =
  String(process.env.LOG_CLIENT_DISABLE_FS || "").toLowerCase() === "true";
const SERVICE_NAME_ENV = (process.env.SERVICE_NAME || "").trim();
const SHOULD_ENABLE_FS_SINK =
  !LOG_CLIENT_DISABLE_FS &&
  (SERVICE_NAME_ENV === "log" || !!process.env.LOG_FS_DIR);
const LOG_FS_DIR = SHOULD_ENABLE_FS_SINK
  ? String(process.env.LOG_FS_DIR || "").trim()
  : "";

function authHeaders(prefer: "current" | "next") {
  const token =
    prefer === "current"
      ? LOG_SERVICE_TOKEN_CURRENT || LOG_SERVICE_TOKEN_NEXT
      : LOG_SERVICE_TOKEN_NEXT || LOG_SERVICE_TOKEN_CURRENT;
  if (!token) throw new Error("No log service token configured");
  return { "content-type": "application/json", "x-internal-key": token };
}

// ───────────────────────────── Helpers & FS fallback ──────────────────────────
function dayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}
function securityFile(d = new Date()) {
  return path.join(LOG_FS_DIR, `security-${dayStr(d)}.log`);
}

async function ensureFsDir() {
  if (!LOG_FS_DIR) return;
  await fsp.mkdir(LOG_FS_DIR, { recursive: true });
}

async function appendSecurityNdjson(event: any) {
  if (!LOG_FS_DIR) return;
  try {
    await ensureFsDir();
    await fsp.appendFile(securityFile(), JSON.stringify(event) + "\n", "utf8");
  } catch {
    // last-ditch: never throw from telemetry path
  }
}

// ───────────────────────────── Event shape & emitter ──────────────────────────
export type SecurityLogDetails = {
  kind: string; // e.g., "rate_limit" | "timeout" | "circuit_open" | "s2s_verify"
  reason: string; // short, non-PII reason ("global_backstop_exceeded", "deadline_exceeded", ...)
  decision: "blocked" | "bypass" | "allow";
  status: number; // HTTP status we returned (e.g., 429/503/504/401/403)
  route: string;
  method: string;
  ip?: string;
  details?: Record<string, unknown>; // small bag for counters/limits; avoid PII
};

/** Extract a stable requestId for correlation without re-minting. */
function requestIdOf(req: Request) {
  const hdr =
    (req.headers["x-request-id"] as string | undefined) ||
    (req.headers["x-correlation-id"] as string | undefined) ||
    (req.headers["x-amzn-trace-id"] as string | undefined);
  return (req as any).id || hdr || null;
}

async function postSecurityToLogSvc(event: Record<string, any>) {
  if (!LOG_SERVICE_URL) return; // drop on floor if misconfigured; we already warned
  try {
    await axios.post(LOG_SERVICE_URL, event, {
      timeout: 1500,
      headers: authHeaders("current"),
    });
  } catch (err: any) {
    const code = err?.response?.status;
    if (
      (code === 401 || code === 403) &&
      LOG_SERVICE_TOKEN_NEXT &&
      LOG_SERVICE_TOKEN_NEXT !== LOG_SERVICE_TOKEN_CURRENT
    ) {
      try {
        await axios.post(LOG_SERVICE_URL, event, {
          timeout: 1500,
          headers: authHeaders("next"),
        });
        return;
      } catch {
        // fall through to FS fallback
      }
    }
    // Final fallback: append locally if enabled
    await appendSecurityNdjson(event);
  }
}

/**
 * Public API: SECURITY telemetry for guardrail decisions.
 *
 * Fire-and-forget usage:
 *   logSecurity(req, { kind:"rate_limit", reason:"global_backstop_exceeded", decision:"blocked", status:429, route:req.path, method:req.method, details:{...} })
 */
export function logSecurity(req: Request, entry: SecurityLogDetails): void {
  try {
    const service = currentServiceName();
    const requestId = requestIdOf(req);
    const ip =
      entry.ip ||
      (req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        .trim() ||
      req.socket.remoteAddress ||
      undefined;

    const payload = {
      channel: "security",
      v: 1,
      eventId: randomUUID(),
      timeCreated: new Date().toISOString(),
      service,
      requestId,
      path: req.originalUrl || req.url,
      ...entry,
      ip,
    };

    // Local dev visibility: also mirror a compact line to pino at warn level.
    logger.warn(
      {
        ch: "SECURITY",
        service,
        requestId,
        reason: entry.reason,
        decision: entry.decision,
        status: entry.status,
        route: entry.route,
        method: entry.method,
        kind: entry.kind,
      },
      "security guardrail decision"
    );

    // Non-blocking network emit with FS fallback if configured.
    void postSecurityToLogSvc(payload);
  } catch {
    // Never throw from telemetry
  }
}
