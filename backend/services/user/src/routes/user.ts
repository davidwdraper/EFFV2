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
//import { UserController } from "../controllers/UserController";

export function authRouter(): Router {
  const r = Router();
  //const ctrl = new UserController();

  return r;
}
