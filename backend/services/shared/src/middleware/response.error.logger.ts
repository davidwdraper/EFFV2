// backend/services/shared/src/middleware/response.error.logger.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0006 (Gateway/Service Edge & Error Logging — one line per request)
 *
 * Purpose:
 * - App-level, per-request completion logger.
 * - Captures JSON bodies (envelopes) and logs a single WARN/ERROR line on failures.
 *
 * Behavior:
 * - Wraps res.json to stash the response body in res.locals._nvBody.
 * - On 'finish', emits:
 *    • warn when statusCode in 400–499 or NV ok=false
 *    • error when statusCode >= 500
 * - Works for proxied/streamed responses too: if body isn’t JSON-captured, we still log by status code.
 */

import type { Request, Response, NextFunction } from "express";
import { UrlHelper } from "../http/UrlHelper";
import { log } from "../util/Logger";

type NvBody = {
  ok?: boolean;
  service?: string;
  data?: { status?: string; detail?: string };
  requestId?: string;
};

export function responseErrorLogger(serviceLabel: string) {
  return function responseErrorLoggerMW(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    // requestId best-effort
    const requestId =
      req.header("x-request-id") ||
      req.header("x-correlation-id") ||
      req.header("request-id") ||
      undefined;

    // slug/version from /api/*, else fall back to service label
    let slug = serviceLabel;
    let version = 1;
    try {
      const addr = UrlHelper.parseApiPath(req.originalUrl);
      if (addr.slug) slug = addr.slug;
      if (addr.version != null) version = addr.version;
    } catch {
      /* not an /api/* path — keep defaults */
    }

    // Wrap res.json to capture JSON body
    const origJson = res.json.bind(res);
    (res as any).json = (body: unknown) => {
      (res.locals as any)._nvBody = body as NvBody;
      return origJson(body);
    };

    // Single completion log per request
    res.on("finish", () => {
      const status = res.statusCode;
      const captured = ((res.locals as any)._nvBody || {}) as NvBody;

      const isEnvelope = typeof captured === "object" && captured !== null;
      const isOkFalse = isEnvelope && captured.ok === false;
      const is4xx = status >= 400 && status < 500;
      const is5xx = status >= 500;

      if (!(isOkFalse || is4xx || is5xx)) return; // success → quiet

      const bound = log.bind({
        slug,
        version,
        requestId,
        method: req.method,
        url: req.originalUrl,
        status,
        upstreamStatus: captured?.data?.status,
      } as any); // keep strictly within BoundCtx; cast guarded

      const detail = captured?.data?.detail;
      if (is5xx) {
        bound.error(detail || "server_error");
      } else {
        bound.warn(detail || "request_failed");
      }
    });

    return next();
  };
}
