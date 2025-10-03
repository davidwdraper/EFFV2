// backend/services/user/src/routes/user.routes.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Wire User endpoints to dedicated controllers (no god-controllers).
 * - Versioned routes under /v1/... (SOP-aligned).
 *
 * Notes:
 * - These endpoints are S2S-only and intended to be called by the Auth service:
 *   - PUT   /v1/users            (create user; ONLY via Auth)
 *   - POST  /v1/signon           (stub)
 *   - POST  /v1/changepassword   (stub)
 * - Temporary S2S guard (header allow-list) will be applied at the app/router level separately.
 */

import { Router } from "express";
import { UserCreateController } from "../controllers/user.create.controller";
import { UserSignonController } from "../controllers/user.signon.controller";
import { UserChangePasswordController } from "../controllers/user.changepassword.controller";

export function usersRouter(): Router {
  const r = Router();

  const create = new UserCreateController();
  const signon = new UserSignonController();
  const change = new UserChangePasswordController();

  // SOP: Create = PUT to plural resource
  r.put("/v1/users", (req, res) => void create.handle(req, res));

  // Auth-driven ops (stubs for now)
  r.post("/v1/signon", (req, res) => void signon.handle(req, res));
  r.post("/v1/changepassword", (req, res) => void change.handle(req, res));

  return r;
}
