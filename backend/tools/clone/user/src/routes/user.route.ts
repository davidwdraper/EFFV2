// backend/services/user/src/routes/user.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; WAL-first writes)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *   - ADR-0056 (DELETE path uses <DtoTypeKey>) — extended to ALL CRUD routes via :dtoType
 *
 * Purpose:
 * - Wire RESTful, versioned CRUD endpoints with explicit DTO type on every route.
 * - Paths are relative to /api/user/v1 (mounted in app.ts).
 *
 * Invariants:
 * - Controllers constructed once per router.
 * - Router stays one-liner thin; no logic here.
 * - Canonical id param is `:id`.
 * - `:dtoType` is a DtoRegistry key; controllers read it from req.params.dtoType and store in ControllerBase.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { UserCreateController } from "../controllers/user.create.controller/user.create.controller";
import { UserReadController } from "../controllers/user.read.controller/user.read.controller";
import { UserDeleteController } from "../controllers/user.delete.controller/user.delete.controller";
import { UserUpdateController } from "../controllers/user.update.controller/user.update.controller";
import { UserListController } from "../controllers/user.list.controller/user.list.controller";

export function buildUserRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Construct controllers once
  const createCtl = new UserCreateController(app);
  const updateCtl = new UserUpdateController(app);
  const readCtl = new UserReadController(app);
  const deleteCtl = new UserDeleteController(app);
  const listCtl = new UserListController(app);

  // CREATE (PUT /:dtoType/create)
  r.put("/:dtoType/create", (req, res) => createCtl.put(req, res));

  // UPDATE (PATCH /:dtoType/update/:id)
  r.patch("/:dtoType/update/:id", (req, res) => updateCtl.patch(req, res));

  // READ (GET /:dtoType/read/:id)
  r.get("/:dtoType/read/:id", (req, res) => readCtl.get(req, res));

  // DELETE (DELETE /:dtoType/delete/:id) — canonical only
  r.delete("/:dtoType/delete/:id", (req, res) => deleteCtl.delete(req, res));

  // LIST (GET /:dtoType/list) — pagination via query (?limit=&cursor=…)
  r.get("/:dtoType/list", (req, res) => listCtl.get(req, res));

  return r;
}
