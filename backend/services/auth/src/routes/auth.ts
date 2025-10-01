// backend/services/auth/src/routes/auth.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: ADR-0004
 *
 * Purpose:
 * - /auth routes (create, signon, changepassword) — mock returns for now.
 */

import { Router } from "express";
import { AuthController } from "../controllers/AuthController";

export function authRouter(): Router {
  const r = Router();
  const ctrl = new AuthController();

  r.post("/create", (req, res) => void ctrl.create(req, res));
  r.post("/signon", (req, res) => void ctrl.signon(req, res));
  r.post("/changepassword", (req, res) => void ctrl.changePassword(req, res));

  return r;
}
