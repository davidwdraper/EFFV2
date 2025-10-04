// backend/services/gateway/src/middleware/edge.hit.logger.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0006 (Gateway Edge Logging — pre-audit, toggleable)
 *
 * Purpose:
 * - Emit exactly one "EDGE YYYY-MM-DD HH:MM:SS <slug> v<version> <url>" line
 *   for every inbound API request at the gateway,
 *   AFTER DoS/DDoS guards and BEFORE routing/auth.
 *
 * Env:
 * - LOG_EDGE  (optional) "1|true|on" enables edge logs (default: off)
 */

import type { Request, Response, NextFunction } from "express";
import { UrlHelper } from "@nv/shared/http/UrlHelper";
import { log } from "@nv/shared/util/Logger";

export function edgeHitLogger() {
  return function edgeHitLoggerMW(
    req: Request,
    _res: Response,
    next: NextFunction
  ) {
    const requestId =
      req.header("x-request-id") ||
      req.header("x-correlation-id") ||
      req.header("request-id") ||
      "" ||
      undefined;

    try {
      const addr = UrlHelper.parseApiPath(req.originalUrl);

      // Full URL for visibility: protocol://host + originalUrl
      // Express sets req.protocol; host may be undefined in some test rigs.
      const host = req.get("host");
      const fullUrl = host
        ? `${req.protocol}://${host}${req.originalUrl}`
        : req.originalUrl;

      const bound = log.bind({
        slug: addr.slug,
        version: addr.version ?? 1,
        requestId,
        url: fullUrl,
      });

      // Bare call prints: "EDGE YYYY-MM-DD HH:MM:SS <slug> v<version> <url>"
      bound.edge();
    } catch {
      // Not an /api/* path — skip quietly
    }

    return next();
  };
}
