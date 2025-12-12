// backend/services/test-log/src/routes/test-log.route.ts
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
 * - Paths are relative to /api/test-log/v1 (mounted in app.ts).
 *
 * Invariants:
 * - Controllers constructed once per router.
 * - Router stays one-liner thin; no logic here.
 * - Canonical id param is `:id`.
 * - `:dtoType` is a DtoRegistry key; controllers read it from req.params.dtoType and store in ControllerBase.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { TestLogCreateController } from "../controllers/create.controller/test-log.create.controller";
import { TestLogReadController } from "../controllers/read.controller/test-log.read.controller";
import { TestLogDeleteController } from "../controllers/delete.controller/test-log.delete.controller";
import { TestLogUpdateController } from "../controllers/update.controller/test-log.update.controller";
import { TestLogListController } from "../controllers/list.controller/test-log.list.controller";

export function buildTestLogRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Construct controllers once
  const createCtl = new TestLogCreateController(app);
  const updateCtl = new TestLogUpdateController(app);
  const readCtl = new TestLogReadController(app);
  const deleteCtl = new TestLogDeleteController(app);
  const listCtl = new TestLogListController(app);

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
