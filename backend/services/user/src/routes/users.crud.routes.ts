// backend/services/user/src/routes/users.crud.routes.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Wire CRUD endpoints (read/update/delete) to dedicated controllers.
 * - Versioned paths under /v1/...; CREATE is intentionally excluded (Auth-only).
 *
 * Notes:
 * - No POST here. No PUT /users here (create is via Auth S2S endpoint).
 * - Future: when S2S JWT lands, apply verifyS2S guard before these routes.
 */

import { Router } from "express";
import { UserReadController } from "../controllers/user.read.controller";
import { UserUpdateController } from "../controllers/user.update.controller";
import { UserDeleteController } from "../controllers/user.delete.controller";

export function usersCrudRouter(): Router {
  const r = Router();

  const read = new UserReadController();
  const update = new UserUpdateController();
  const remove = new UserDeleteController();

  // READ: GET /v1/users/:id
  r.get("/v1/users/:id", (req, res) => void read.handle(req, res));

  // UPDATE: PATCH /v1/users/:id
  r.patch("/v1/users/:id", (req, res) => void update.handle(req, res));

  // DELETE: DELETE /v1/users/:id
  r.delete("/v1/users/:id", (req, res) => void remove.handle(req, res));

  return r;
}
