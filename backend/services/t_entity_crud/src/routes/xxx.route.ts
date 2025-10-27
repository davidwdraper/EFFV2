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
// (Placeholders for later routes if/when you add them)
// import { XxxReadController } from "../controllers/xxx.read.controller";
// import { XxxUpdateController } from "../controllers/xxx.update.controller";
// import { XxxDeleteController } from "../controllers/xxx.delete.controller";
// import { XxxListController } from "../controllers/xxx.list.controller";

export function buildXxxRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Construct controllers ONCE, injecting the App (gives them logger + svcEnv)
  const createCtl = new XxxCreateController(app);
  // const readCtl = new XxxReadController(app);
  // const updateCtl = new XxxUpdateController(app);
  // const deleteCtl = new XxxDeleteController(app);
  // const listCtl = new XxxListController(app);

  // Mount **relative** to /api/<slug>/v<version>
  r.put("/create", (req, res) => createCtl.put(req, res));
  // r.get("/:xxxId", (req, res) => readCtl.get(req, res));
  // r.patch("/:xxxId", (req, res) => updateCtl.patch(req, res));
  // r.delete("/:xxxId", (req, res) => deleteCtl.delete(req, res));
  // r.get("/list", (req, res) => listCtl.get(req, res));

  return r;
}
