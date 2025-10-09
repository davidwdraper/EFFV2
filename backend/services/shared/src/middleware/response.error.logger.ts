// backend/services/shared/src/middleware/response.error.logger.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0015 (Logger with bind() Context)
 *   - ADR-0018 (Debug Log Origin Capture)
 *
 * Purpose:
 * - Express error-funnel middleware that logs every uncaught error.
 *
 * Usage:
 *   app.use(responseErrorLogger(log))     // preferred: pass IBoundLogger
 *   app.use(responseErrorLogger("audit")) // legacy: pass service name
 *
 * Invariance:
 * - No env literals beyond SVC_NAME (name only).
 */

import type { Request, Response, NextFunction } from "express";
import type { IBoundLogger } from "@nv/shared/logger/Logger";
import { getLogger } from "@nv/shared/logger/Logger";

export function responseErrorLogger(arg: IBoundLogger | string) {
  const isString = typeof arg === "string";
  const serviceName = isString
    ? (arg as string)
    : process.env.SVC_NAME || "unknown";

  const log: IBoundLogger = isString
    ? getLogger().bind({
        service: serviceName,
        component: "responseErrorLogger",
      })
    : (arg as IBoundLogger).bind({ component: "responseErrorLogger" });

  return function errorLogger(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction
  ) {
    const requestId =
      (req.headers["x-request-id"] as string) ||
      (req.headers["x-requestid"] as string) ||
      (req.headers["x_request_id"] as string) ||
      "unknown";

    const message =
      err instanceof Error
        ? err.message
        : err != null
        ? String(err)
        : "Unknown error";

    // Log once, structured
    log.error({ requestId, err: message }, "unhandled error");

    // Emit canonical problem envelope
    res.status(500).json({
      ok: false,
      service: serviceName,
      requestId,
      error: { code: "internal_error", message },
    });
  };
}
