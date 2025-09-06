// backend/services/gateway/src/internal/svcconfig.internal.ts
import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import type { ServiceConfig } from "@shared/contracts/svcconfig.contract";

/** Snapshot shape returned by getSvcconfigSnapshot() */
export type SvcconfigSnapshot = {
  version: string; // monotonic version (for ETag)
  updatedAt: number; // epoch ms of last refresh
  services: Record<string, ServiceConfig>; // keyed by slug (lowercase)
};

export type Deps = {
  /**
   * Express-compatible middleware that validates S2S:
   *   audience: "internal-services"
   *   allowedIssuers: ["gateway-core","gateway"]
   *   allowedCallers: ["gateway-core"]
   */
  verifyS2S: (req: Request, res: Response, next: NextFunction) => void;

  /**
   * Returns the current in-memory svcconfig snapshot (or null if uninitialized).
   * MUST be fast and side-effect free.
   */
  getSvcconfigSnapshot: () => SvcconfigSnapshot | null;
};

/**
 * Private internal endpoints:
 *   GET /__internal/svcconfig/services        → full dump + ETag: "v:<version>"
 *   GET /__internal/svcconfig/services/:slug  → single entry + ETag
 *
 * Honors If-None-Match for 304 responses.
 */
export default function createSvcconfigInternalRouter({
  verifyS2S,
  getSvcconfigSnapshot,
}: Deps) {
  const router = Router();

  // Guard all routes with S2S verification
  router.use(verifyS2S);

  // GET full dump
  router.get("/services", (req: Request, res: Response) => {
    const snap = getSvcconfigSnapshot();
    if (!snap) {
      return res.status(503).json({
        type: "about:blank",
        title: "Service Config Unavailable",
        status: 503,
        detail: "svcconfig cache is not initialized",
      });
    }

    const etag = `"v:${snap.version}"`;
    const inm = req.headers["if-none-match"];

    if (typeof inm === "string" && inm === etag) {
      return res.status(304).end();
    }

    res.setHeader("ETag", etag);
    return res.status(200).json({
      ok: true,
      version: snap.version,
      updatedAt: snap.updatedAt,
      services: snap.services,
    });
  });

  // GET one slug
  router.get("/services/:slug", (req: Request, res: Response) => {
    const snap = getSvcconfigSnapshot();
    if (!snap) {
      return res.status(503).json({
        type: "about:blank",
        title: "Service Config Unavailable",
        status: 503,
        detail: "svcconfig cache is not initialized",
      });
    }

    const slug = String(req.params.slug || "")
      .trim()
      .toLowerCase();
    const entry = snap.services[slug];

    if (!entry) {
      return res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: `No svcconfig entry for slug "${slug}"`,
      });
    }

    const etag = `"v:${snap.version}"`;
    const inm = req.headers["if-none-match"];

    if (typeof inm === "string" && inm === etag) {
      return res.status(304).end();
    }

    res.setHeader("ETag", etag);
    return res.status(200).json({
      ok: true,
      version: snap.version,
      updatedAt: snap.updatedAt,
      service: entry,
    });
  });

  return router;
}
