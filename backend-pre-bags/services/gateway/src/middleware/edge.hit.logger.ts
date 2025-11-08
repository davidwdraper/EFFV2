// backend/services/gateway/src/middleware/edge.hit.logger.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0006 (Gateway Edge Logging — pre-audit, toggleable)
 *
 * Purpose:
 * - Emit exactly one "EDGE ..." line for every inbound /api/* gateway request,
 *   AFTER DoS/DDoS guards and BEFORE routing/auth.
 *
 * Invariants:
 * - Always produces a concrete requestId (propagated or minted).
 * - Never throws; logging must not break request flow.
 */

import type { Request, Response, NextFunction } from "express";
import { getLogger } from "@nv/shared/logger/Logger";
import { randomUUID } from "crypto";

/**
 * Resilient parser:
 *  - Extracts "<slug>" and "v<major>" from /api/<slug>/v<major>/...
 *  - Falls back to { slug: "gateway", version: 1 } if not matched.
 */
function deriveSlugAndVersion(path: string): { slug: string; version: number } {
  const m = path.match(/^\/api\/([a-z][a-z0-9-]*)\/v(\d+)\b/i);
  if (m) {
    const slug = m[1].toLowerCase();
    const version = Number(m[2]) || 1;
    return { slug, version };
  }
  return { slug: "gateway", version: 1 };
}

/** Header-insensitive request id pick with mint fallback. */
function pickOrMintRequestId(h: Record<string, unknown>): string {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(h || {})) {
    if (v == null) continue;
    lower[k.toLowerCase()] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  return (
    lower["x-request-id"] ||
    lower["x-correlation-id"] ||
    lower["request-id"] ||
    randomUUID()
  );
}

export function edgeHitLogger() {
  return function edgeHitLoggerMW(
    req: Request,
    _res: Response,
    next: NextFunction
  ) {
    // Only edge-log API traffic.
    if (!req.originalUrl.startsWith("/api/")) return next();

    // Guarantee a requestId for downstream (proxy/audit) and logging.
    const requestId = pickOrMintRequestId(req.headers);
    // Stash for later middleware; proxy will forward this upstream.
    (req as any).__edgeRequestId = requestId;

    const host = req.get("host");
    const fullUrl = host
      ? `${req.protocol}://${host}${req.originalUrl}`
      : req.originalUrl;

    const { slug, version } = deriveSlugAndVersion(req.originalUrl);

    // Structured, single edge line.
    getLogger()
      .bind({
        slug,
        version,
        requestId, // ← always defined
        url: fullUrl,
        method: req.method,
        component: "edge.hit.logger",
      })
      .edge("edge_hit");

    return next();
  };
}
