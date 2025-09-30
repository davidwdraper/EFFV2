// backend/services/svcfacilitator/src/routes/health.ts
/**
 * Purpose:
 * - /health route using HealthController.
 */
import { Router } from "express";
import { HealthController } from "../controllers/HealthController";

export function healthRouter(): Router {
  const r = Router();
  const ctrl = new HealthController();
  r.get("/", (req, res) => void ctrl.getHealth(req, res));
  return r;
}
