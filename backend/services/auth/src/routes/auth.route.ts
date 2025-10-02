// backend/services/auth/src/routes/auth.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: ADR-0004 (Auth Service Skeleton — no minting)
 *
 * Purpose:
 * - Wire Auth endpoints to dedicated controllers (no god-controllers).
 * - Versioned routes under /v1/...; temporary unversioned fallbacks retained.
 *
 * Notes:
 * - Gateway canonical path is /api/auth/v1/* (app mount may be updated later).
 * - This router exposes both /v1/* and non-versioned aliases for now.
 */

import { Router } from "express";
import { AuthCreateController } from "../controllers/auth.create.controller";
import { AuthSignonController } from "../controllers/auth.signon.controller";
import { AuthChangePasswordController } from "../controllers/auth.changepassword.controller";

export function authRouter(): Router {
  const r = Router();

  const create = new AuthCreateController();
  const signon = new AuthSignonController();
  const change = new AuthChangePasswordController();

  r.post("/v1/create", (req, res) => void create.handle(req, res));
  r.post("/v1/signon", (req, res) => void signon.handle(req, res));
  r.post("/v1/changepassword", (req, res) => void change.handle(req, res));

  return r;
}
