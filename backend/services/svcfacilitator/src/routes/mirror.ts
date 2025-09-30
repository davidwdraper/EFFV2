// backend/services/svcfacilitator/src/routes/mirror.ts
/**
 * Purpose:
 * - /mirror routes
 */
import { Router } from "express";
import { MirrorController } from "../controllers/MirrorController";

export function mirrorRouter(): Router {
  const r = Router();
  const ctrl = new MirrorController();
  r.post("/load", (req, res) => void ctrl.mirrorLoad(req, res));
  return r;
}
