// backend/services/t_entity_crud/src/routes/xxx.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; WAL-first writes)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *   - ADR-0056 (DELETE path uses <DtoTypeKey>)
 *
 * Purpose:
 * - Wire RESTful, versioned CRUD endpoints with explicit DTO type on DELETE.
 * - Paths are relative to /api/xxx/v1 (mounted in app.ts).
 *
 * Invariants:
 * - Controllers constructed once per router.
 * - Router stays one-liner thin; no logic here.
 * - Canonical id param is `:id`.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { XxxCreateController } from "../controllers/xxx.create.controller/xxx.create.controller";
import { XxxReadController } from "../controllers/xxx.read.controller/xxx.read.controller";
import { XxxDeleteController } from "../controllers/xxx.delete.controller/xxx.delete.controller";
import { XxxUpdateController } from "../controllers/xxx.update.controller/xxx.update.controller";
import { XxxListController } from "../controllers/xxx.list.controller/xxx.list.controller";

export function buildXxxRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Construct controllers once
  const createCtl = new XxxCreateController(app);
  const updateCtl = new XxxUpdateController(app);
  const readCtl = new XxxReadController(app);
  const deleteCtl = new XxxDeleteController(app);
  const listCtl = new XxxListController(app);

  // CREATE (PUT /)
  r.put("/", (req, res) => createCtl.put(req, res));

  // UPDATE (PATCH /:id)
  r.patch("/:id", (req, res) => updateCtl.patch(req, res));

  // READ (GET /:id) — template service has a single DTO today
  r.get("/:id", (req, res) => readCtl.get(req, res));

  // DELETE (DELETE /:typeKey/:id) — multi-DTO safe; typeKey is a DtoRegistry key
  r.delete("/:typeKey/:id", (req, res) => deleteCtl.delete(req, res));

  // LIST (GET /) — pagination via query (?limit=&cursor=…)
  r.get("/", (req, res) => listCtl.get(req, res));

  return r;
}
