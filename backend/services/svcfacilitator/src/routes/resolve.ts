// backend/services/svcfacilitator/src/routes/resolve.ts
/**
 * Docs:
 * - SOP: svcfacilitator is the source of truth; gateway mirrors from it.
 *
 * Purpose:
 * - Route layer for (slug, version) → baseUrl resolution.
 * - Thin wrapper that delegates to ResolveController (BaseController subclass).
 *
 * Contract:
 *   GET /api/svcfacilitator/resolve?key=<slug@version>
 *   GET /api/svcfacilitator/resolve/:slug/v:version
 */

import { Router } from "express";
import { ResolveController } from "../controllers/resolve.controller";

export function resolveRouter(): Router {
  const r = Router();
  const ctrl = new ResolveController();

  // Routes are one-liners — handlers bound via BaseController.h()
  r.get(
    "/resolve",
    ctrl.h(async ({ requestId }) =>
      ctrl.resolveByKey({
        requestId,
        key: (r as any).query?.key ?? (r as any).query?.slug, // gracefully accept ?key= or ?slug=
        body: undefined,
      })
    )
  );

  r.get(
    "/resolve/:slug/v:version",
    ctrl.h(async ({ requestId }) =>
      ctrl.resolveByParams({
        requestId,
        slug: (r as any).params?.slug,
        version: (r as any).params?.version,
        body: undefined,
      })
    )
  );

  return r;
}
