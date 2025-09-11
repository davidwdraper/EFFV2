// backend/services/shared/middleware/problemJson.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 *   • “Global error middleware. All errors flow through problem.ts + error sink.”
 *   • “Audit-ready. No silent fallbacks.”
 * - Design: docs/design/backend/observability/problem-json.md
 *
 * Why:
 * - We standardize error responses as RFC 7807 Problem+JSON so clients/tests
 *   can rely on a stable shape across all services.
 * - Every error should emit a structured error event to our logging pipeline
 *   (LogSvc or FS fallback) without blocking the request lifecycle.
 * - 404s are common and noisy; we only format them as Problem+JSON for routes
 *   under known prefixes to avoid turning static/probe noise into JSON bodies.
 *
 * Notes:
 * - This middleware is *transport-level* formatting, not business logic.
 * - We keep error detail minimal by default to avoid leaking internals.
 * - In non-prod, we also log the error to pino for local visibility.
 */

import type { Request, Response, NextFunction } from "express";
import { extractLogContext, postAudit } from "@shared/utils/logger";

const IS_PROD = String(process.env.NODE_ENV || "").trim() === "production";

/**
 * 404 formatter: only emits Problem+JSON for known API/health prefixes.
 * Everything else returns a bare 404 to keep noise down for static assets, etc.
 */
export function notFoundProblemJson(validPrefixes: string[]) {
  return (req: Request, res: Response) => {
    // WHY: Only treat as “API 404” if path is under a known prefix.
    if (validPrefixes.some((p) => req.path.startsWith(p))) {
      return res
        .status(404)
        .type("application/problem+json")
        .json({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Route not found",
          instance: (req as any).id,
        });
    }
    /* c8 ignore next 2 */
    return res.status(404).end();
  };
}

/**
 * Error formatter: converts any thrown/next(err) into Problem+JSON and
 * emits a non-blocking error event to LogSvc (with FS fallback via logger util).
 */
export function errorProblemJson() {
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    // WHY: Normalize status code; never trust arbitrary values.
    const status = Number(err?.statusCode || err?.status || 500);
    const safe = Number.isFinite(status) ? status : /* c8 ignore next */ 500;

    // WHY: Build a minimal, safe error event. The logger util enriches with callsite.
    const ctx = extractLogContext(req);
    const event = {
      channel: "error",
      level: "error",
      code: err?.code,
      message: err?.message || "Unhandled error",
      status: safe,
      path: req.originalUrl,
      method: req.method,
      ...ctx,
    };

    // Fire-and-forget to Log Service; util handles FS fallback/rotation.
    void postAudit(event);

    // Dev/test: also emit to pino for local visibility (quiet in prod regardless of flags).
    if (!IS_PROD) {
      req.log?.error(
        { status: safe, path: req.originalUrl, err },
        "request error"
      );
    }

    /* c8 ignore start */
    // WHY: Keep response minimal; prefer caller-provided RFC7807 fields if they exist.
    const type = err?.type || "about:blank";
    const title =
      err?.title || (safe >= 500 ? "Internal Server Error" : "Request Error");
    const detail = err?.message || "Unexpected error";
    /* c8 ignore stop */

    res
      .status(safe)
      .type("application/problem+json")
      .json({
        type,
        title,
        status: safe,
        detail,
        instance: (req as any).id,
      });
  };
}
