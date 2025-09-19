// backend/services/gateway/src/middleware/parseExternalTarget.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - Route: docs/architecture/shared/ROUTE_CONVENTIONS.md
 * - APRs:
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md  (APR-0029)
 *
 * Why:
 * - Enforce external path shape: /api/<slug>.<Version>/<rest>
 * - Populate req.nvTarget = { slug, version, restPath }
 */

import type { Request, Response, NextFunction } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      nvTarget?: { slug: string; version: string; restPath: string };
    }
  }
}

function normalizeVersion(v: string) {
  const m = String(v || "")
    .trim()
    .match(/^v?(\d+)$/i);
  return m ? `V${m[1]}` : null;
}

export function parseExternalTarget(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const m = req.path.match(/^\/api\/([^/.]+)\.([^/]+)\/?(.*)$/);
  if (!m) {
    return res.status(400).json({
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "Expected /api/<slug>.<Version>/..., e.g. /api/user.V1/users",
      instance: (req as any).id,
    });
  }
  const slug = m[1].toLowerCase();
  const ver = normalizeVersion(m[2]);
  if (!ver) {
    return res.status(400).json({
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: `Invalid version "${m[2]}". Use V1, V2, ...`,
      instance: (req as any).id,
    });
  }
  const restPath = m[3] || "";
  req.nvTarget = { slug, version: ver, restPath };
  return next();
}
