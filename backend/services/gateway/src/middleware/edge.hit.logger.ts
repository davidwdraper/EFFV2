// backend/services/gateway/src/middleware/edge.hit.logger.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0006 (Gateway Edge Logging — pre-audit, toggleable)
 *
 * Purpose:
 * - Emit exactly one "EDGE YYYY-MM-DD HH:MM:SS <slug> v<version> <url>" line
 *   for every inbound /api/* request at the gateway,
 *   AFTER DoS/DDoS guards and BEFORE routing/auth.
 *
 * Env:
 * - LOG_EDGE  (optional) "1|true|on" enables edge logs (default: off)
 */

import type { Request, Response, NextFunction } from "express";
import { getLogger } from "@nv/shared/util/logger.provider";

/**
 * Resilient parser:
 *  - Tries to extract "<slug>" and "v<major>" from /api/<slug>/v<major>/...
 *  - Falls back to { slug: "gateway", version: 1 } if not matched.
 *  - Never throws; logging should never break the request flow.
 */
function deriveSlugAndVersion(path: string): { slug: string; version: number } {
  const m = path.match(/^\/api\/([a-z][a-z0-9-]*)\/v(\d+)\b/i);
  if (m) {
    const slug = m[1].toLowerCase();
    const version = Number(m[2]) || 1;
    return { slug, version };
  }
  // Health or non-versioned paths still log as gateway edge activity
  return { slug: "gateway", version: 1 };
}

export function edgeHitLogger() {
  return function edgeHitLoggerMW(
    req: Request,
    _res: Response,
    next: NextFunction
  ) {
    // Only edge-log API traffic.
    if (!req.originalUrl.startsWith("/api/")) return next();

    const requestId =
      req.header("x-request-id") ||
      req.header("x-correlation-id") ||
      req.header("request-id") ||
      undefined;

    const host = req.get("host");
    const fullUrl = host
      ? `${req.protocol}://${host}${req.originalUrl}`
      : req.originalUrl;

    const { slug, version } = deriveSlugAndVersion(req.originalUrl);

    // Use the injected process-wide logger if present (Bootstrap installs it),
    // otherwise the provider falls back to the base logger.
    const logger = getLogger().bind({
      slug,
      version,
      requestId,
      url: fullUrl,
    });

    // One line, controlled by LOG_EDGE.
    logger.edge();

    return next();
  };
}
