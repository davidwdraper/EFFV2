// backend/services/gateway/src/middleware/requestId.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • “Instrumentation everywhere. RequestId on entry/exit.”
 *   • “Audit-ready: all logs/events must be correlated via x-request-id.”
 *
 * Why:
 * The requestId is the correlation key that ties together:
 *   - Telemetry (pino-http logs)
 *   - Security logs (guardrail denials)
 *   - Audit WAL events (billing-grade capture)
 *
 * This middleware ensures every inbound request has a stable `x-request-id`.
 * - If the caller supplied one (via common headers), we propagate it.
 * - If missing, we mint a UUIDv4.
 * - We attach it to both `req` (for app code/logs) and the response header
 *   so downstream consumers can continue the trace.
 *
 * Notes:
 * - Runs very early in the pipeline (before logging, guardrails, audit).
 * - Must be idempotent: never overwrite an existing value with a new one.
 */

import type { RequestHandler } from "express";
import { randomUUID } from "crypto";

export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    // WHY: accept common correlation headers (propagate if present).
    const hdr =
      req.headers["x-request-id"] ||
      req.headers["x-correlation-id"] ||
      req.headers["x-amzn-trace-id"];

    // WHY: generate UUID only if no header is present.
    const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();

    // WHY: attach to request for in-process loggers and handlers.
    (req as any).id = String(id);

    // WHY: echo back on response so clients/next hops can correlate.
    res.setHeader("x-request-id", String(id));

    next();
  };
}
