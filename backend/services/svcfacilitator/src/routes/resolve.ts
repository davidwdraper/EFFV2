// backend/services/svcfacilitator/src/routes/resolve.ts
/**
 * Docs:
 * - SOP: svcfacilitator is the source of truth; gateway mirrors from it.
 *
 * Purpose:
 * - Route layer for (slug, version) → baseUrl resolution.
 * - Thin wrapper that delegates to ResolveController.
 *
 * Contract:
 *   GET /api/svcfacilitator/resolve?slug=<slug>&version=<major>
 */

import { Router } from "express";
import { ResolveController } from "../controllers/resolve.controller";

export function resolveRouter(): Router {
  const r = Router();
  const controller = new ResolveController();

  // Routes are one-liners — import handlers only.
  r.get("/resolve", (req, res) => {
    controller.handle(req, res);
  });

  return r;
}
