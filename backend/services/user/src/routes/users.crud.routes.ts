// backend/services/user/src/routes/users.crud.routes.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Wire CRUD endpoints (read/update/delete) to dedicated controllers.
 * - Paths here are relative to the /api/<SVC_NAME>/v1 mount in app.ts.
 *
 * Notes:
 * - CREATE is intentionally excluded (Auth-only via S2S).
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

  // READ: GET /users/:id
  r.get("/users/:id", (req, res) => void read.handle(req, res));

  // UPDATE: PATCH /users/:id
  r.patch("/users/:id", (req, res) => void update.handle(req, res));

  // DELETE: DELETE /users/:id
  r.delete("/users/:id", (req, res) => void remove.handle(req, res));

  return r;
}
