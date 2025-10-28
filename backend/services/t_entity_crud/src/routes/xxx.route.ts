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

export function buildXxxRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Construct controllers ONCE, injecting the App (gives them logger + svcEnv)
  const createCtl = new XxxCreateController(app);
  const readCtl = new XxxReadController(app);

  // Mount **relative** to /api/<slug>/v<version>
  r.put("/create", (req, res) => createCtl.put(req, res));

  // Support BOTH shapes:
  //   /read?id=<_id>      (query)
  //   /read/<_id>         (path param)
  r.get("/read", (req, res) => readCtl.get(req, res));
  r.get("/read/:xxxId", (req, res) => readCtl.get(req, res));

  return r;
}
