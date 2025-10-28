// backend/services/t_entity_crud/src/routes/xxx.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Controller & Handler Architecture — per-route controllers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0040 (DTO-Only Persistence; WAL-first writes)
 *
 * Purpose:
 * - Build a router bound to this App instance, passing the App into controllers.
 * - Paths are **relative** to the versioned base mounted by App (e.g., /api/xxx/v1).
 *
 * Invariants:
 * - Controller instances are constructed once (no per-request `new`).
 * - Router wires one-liners only; no business logic here.
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

  // LIST
  r.get("/list", (req, res) => listCtl.get(req, res));

  // CREATE
  r.put("/create", (req, res) => createCtl.put(req, res));

  // UPDATE — canonical path-param form
  r.patch("/:xxxId", (req, res) => updateCtl.patch(req, res));

  // READ — support query + param
  r.get("/read", (req, res) => readCtl.get(req, res));
  r.get("/read/:xxxId", (req, res) => readCtl.get(req, res));

  // DELETE — support query + param + bare /:xxxId (smoke #8 uses the bare form)
  r.delete("/delete", (req, res) => deleteCtl.delete(req, res));
  r.delete("/delete/:xxxId", (req, res) => deleteCtl.delete(req, res));
  r.delete("/:xxxId", (req, res) => deleteCtl.delete(req, res));

  return r;
}
