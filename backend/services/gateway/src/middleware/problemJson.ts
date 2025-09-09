// backend/services/gateway/src/middleware/problemJson.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • “Global error middleware. All errors flow through problem.ts + error sink.”
 *   • “Instrumentation everywhere. Never block foreground traffic.”
 * - RFC 7807: Problem Details for HTTP APIs (application/problem+json)
 *
 * Why:
 * We standardize error responses across the gateway using RFC 7807 so callers and tests
 * can rely on a predictable envelope. This middleware:
 *   1) Adds `res.problem(status, body)` for handlers to emit RFC 7807 errors without fuss.
 *   2) Provides a 404 tail handler with the same envelope.
 *   3) Provides a global error handler that logs 5xx with a trimmed stack (to logs only)
 *      while returning a sanitized problem+json body to clients (no stack traces over the wire).
 *
 * Notes:
 * - We do not emit SECURITY logs here: this is not a guardrail denial. Guardrails (auth/rate limit/
 *   breaker/timeouts) must log via `logSecurity` themselves. This file focuses on consistent
 *   client-facing error shapes and non-blocking diagnostics to pino.
 * - We keep logs lean (stack trimmed) and avoid PII/body echoing in the response.
 */

import type { RequestHandler, ErrorRequestHandler } from "express";
import { logger } from "@shared/utils/logger";

// ──────────────────────────────────────────────────────────────────────────────
// Extend Express Response with a typed helper for problem+json.
// We intentionally leave normal 2xx JSON responses untouched.
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Response {
      /**
       * Send an RFC 7807 problem+json response.
       * WHY: centralize the shape and content-type; avoid ad-hoc error bodies.
       */
      problem?: (status: number, body: Record<string, any>) => void;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

// WHY: produce a best-effort request id for logs/responses when handlers don’t have it handy.
function ridOf(req: any): string {
  return (
    req?.id ||
    req?.headers?.["x-request-id"] ||
    req?.headers?.["x-correlation-id"] ||
    req?.headers?.["x-amzn-trace-id"] ||
    ""
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Middleware: attach res.problem helper
export const problemJsonMiddleware = (): RequestHandler => {
  return (_req, res, next) => {
    res.problem = (status: number, body: Record<string, any>) => {
      // WHY: enforce RFC 7807 content-type only for error responses.
      res.status(status);
      res.type("application/problem+json");
      res.json(body);
    };
    next();
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// 404 tail handler — consistent envelope, no stack, includes instance (req id)
export const notFoundHandler = (): RequestHandler => {
  return (req, res) => {
    (res.problem ?? res.status.bind(res))(404, {
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "Route not found",
      instance: (req as any).id,
    });
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Global error handler — logs server faults, returns sanitized problem+json
export const errorHandler = (): ErrorRequestHandler => {
  return (err, req, res, _next) => {
    // WHY: prefer explicit numeric status, default to 500 for unknown errors.
    const status = Number(err?.status || err?.statusCode || 500);

    // WHY: avoid double-send; if headers already went out, we can’t shape a new response.
    if (res.headersSent) {
      // Minimal diagnostic; do not attempt to write the body.
      logger.debug(
        {
          sentinel: "500DBG",
          where: "errorHandler(headersSent)",
          rid: String(ridOf(req)),
          method: req.method,
          url: req.originalUrl,
          status,
          name: err?.name,
          message: err?.message,
          // WHY: trim noisy stacks; logs are for operators, not clients.
          stack: String(err?.stack || "")
            .split("\n")
            .slice(0, 8),
        },
        "error after headers sent"
      );
      return; // let Express finalize
    }

    // <<<500DBG>>> log 5xx with trimmed stack before responding
    if (Number.isFinite(status) && status >= 500) {
      logger.debug(
        {
          sentinel: "500DBG",
          where: "errorHandler",
          rid: String(ridOf(req)),
          method: req.method,
          url: req.originalUrl,
          status,
          name: err?.name,
          message: err?.message,
          stack: String(err?.stack || "")
            .split("\n")
            .slice(0, 8),
        },
        "500 about to be sent <<<500DBG>>>"
      );
    }

    // WHY: never leak raw stack or internal fields to clients. Keep it minimal and consistent.
    (res.problem ?? res.status.bind(res))(
      Number.isFinite(status) ? status : 500,
      {
        type: err?.type || "about:blank",
        title:
          err?.title || (status >= 500 ? "Internal Server Error" : "Error"),
        status: Number.isFinite(status) ? status : 500,
        detail: err?.message || "Unexpected error",
        instance: (req as any).id,
      }
    );
  };
};
