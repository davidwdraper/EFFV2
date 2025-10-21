// backend/services/svcfacilitator/src/middleware/debug.inbound.headers.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose (TEMPORARY — REMOVE after debugging):
 * - Log inbound method, path, and whether Authorization header exists.
 * - Runs early so we can see requests before any guards mutate control flow.
 */

import type { Request, Response, NextFunction } from "express";

export function debugInboundHeaders(logger: {
  debug: (msg: string, ...rest: unknown[]) => void;
}) {
  return function (req: Request, _res: Response, next: NextFunction) {
    const hasAuth = Boolean(req.headers.authorization);
    logger.debug(
      "inbound %s %s auth=%s",
      req.method,
      req.path || req.originalUrl,
      hasAuth ? "present" : "absent"
    );
    next();
  };
}
