// backend/services/shared/src/middleware/apiVersion.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0029-versioned-s2s-and-x-nv-api-version.md
 *
 * Why:
 * - Services receive version context via "X-NV-Api-Version: v<NUM>" from the gateway.
 * - Keep routes one-liners by selecting the correct handler in a shared middleware.
 *
 * Behavior:
 * - If the header is missing or invalid, default to v1.
 * - If no handler exists for the requested version, return 404 (route not found).
 *
 * Notes:
 * - Case-insensitive header; accepts "v1" or "1", normalized to number 1.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

export function getApiVersion(req: Request): number {
  const raw =
    (req.headers["x-nv-api-version"] as string | undefined) ??
    (req.headers["X-NV-Api-Version"] as unknown as string | undefined) ??
    "";
  const m = /^v?(\d+)$/i.exec(raw.trim());
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

type VersionMap = Record<number, RequestHandler> & { default?: RequestHandler };

/**
 * versioned — choose a handler by API version (default v1).
 * Example:
 *   router.get("/things", cacheGet("x","TTL"), versioned({ 1: listV1, 2: listV2 }));
 */
export function versioned(map: VersionMap): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const v = getApiVersion(req);
    const h: RequestHandler | undefined = map[v] ?? map.default ?? map[1];
    if (!h) {
      return res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: `No handler for API version v${v}`,
        instance: (req as any).id,
      });
    }
    return h(req, res, next);
  };
}
