// backend/services/gateway/src/routes/hello.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
 *
 * Purpose:
 * - Router factory for /api/hello endpoints.
 */

import { Router } from "express";
import { HelloController } from "../controllers/HelloController";

export function helloRouter(): Router {
  const r = Router();
  const ctrl = new HelloController();
  r.get("/", (req, res) => ctrl.getHello(req, res));
  return r;
}
