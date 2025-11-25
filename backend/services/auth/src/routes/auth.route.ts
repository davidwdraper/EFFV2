// backend/services/auth/src/routes/auth.route.ts
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
 * - Paths are relative to /api/auth/v1 (mounted in app.ts).
 *
 * Invariants:
 * - Controllers constructed once per router.
 * - Router stays one-liner thin; no logic here.
 * - Canonical id param is `:id`.
 * - `:dtoType` is a DtoRegistry key; controllers read it from req.params.dtoType and store in ControllerBase.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { AuthCreateController } from "../controllers/auth.create.controller/auth.create.controller";
import { AuthReadController } from "../controllers/auth.read.controller/auth.read.controller";
import { AuthDeleteController } from "../controllers/auth.delete.controller/auth.delete.controller";
import { AuthUpdateController } from "../controllers/auth.update.controller/auth.update.controller";
import { AuthListController } from "../controllers/auth.list.controller/auth.list.controller";

export function buildAuthRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Construct controllers once
  const createCtl = new AuthCreateController(app);
  const updateCtl = new AuthUpdateController(app);
  const readCtl = new AuthReadController(app);
  const deleteCtl = new AuthDeleteController(app);
  const listCtl = new AuthListController(app);

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
