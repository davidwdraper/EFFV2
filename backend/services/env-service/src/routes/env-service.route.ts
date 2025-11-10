// backend/services/env-service/src/routes/env-service.route.ts
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
 * - Paths are relative to /api/env-service/v1 (mounted in app.ts).
 *
 * Invariants:
 * - Controllers constructed once per router.
 * - Router stays one-liner thin; no logic here.
 * - Canonical id param is `:id`.
 * - `:dtoType` is a DtoRegistry key; controllers read it from req.params.dtoType and store in ControllerBase.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { EnvServiceCreateController } from "../controllers/env-service.create.controller/env-service.create.controller";
import { EnvServiceReadController } from "../controllers/env-service.read.controller/env-service.read.controller";
import { EnvServiceDeleteController } from "../controllers/env-service.delete.controller/env-service.delete.controller";
import { EnvServiceUpdateController } from "../controllers/env-service.update.controller/env-service.update.controller";
import { EnvServiceListController } from "../controllers/env-service.list.controller/env-service.list.controller";

export function buildEnvServiceRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Construct controllers once
  const createCtl = new EnvServiceCreateController(app);
  const updateCtl = new EnvServiceUpdateController(app);
  const readCtl = new EnvServiceReadController(app);
  const deleteCtl = new EnvServiceDeleteController(app);
  const listCtl = new EnvServiceListController(app);

  // CREATE / CLONE (PUT /:dtoType/:op[…])
  //
  // - Standard create:
  //     PUT /:dtoType/create
  // - Clone:
  //     PUT /:dtoType/clone/:sourceKey/:targetSlug
  //
  // Controller will inspect req.params.op and choose the appropriate pipeline.
  r.put("/:dtoType/:op", (req, res) => createCtl.put(req, res));
  r.put("/:dtoType/:op/:sourceKey/:targetSlug", (req, res) =>
    createCtl.put(req, res)
  );

  // UPDATE (PATCH /:dtoType/update/:id)
  r.patch("/:dtoType/update/:id", (req, res) => updateCtl.patch(req, res));

  // DELETE (DELETE /:dtoType/delete/:id)
  r.delete("/:dtoType/delete/:id", (req, res) => deleteCtl.delete(req, res));

  // LIST (GET /:dtoType/list) — pagination via query (?limit=&cursor=…)
  // NOTE: must be registered before the generic :op route so "list" is not captured as :op.
  r.get("/:dtoType/list", (req, res) => listCtl.get(req, res));

  // READ / CONFIG / future ops:
  // - Read by id:  GET /:dtoType/read/:id
  // - Config by key: GET /:dtoType/config  (query: slug, version, env?, level?)
  //
  // Controller will inspect req.params.op and pick the correct handler pipeline.
  r.get("/:dtoType/:op/:id?", (req, res) => readCtl.get(req, res));

  return r;
}
