// backend/services/env-service/src/routes/env-service.route.ts
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
 * - Paths are **relative** to the versioned base mounted by App (e.g., /api/env-service/v1).
 *
 * Invariants:
 * - Controller instances are constructed once (no per-request `new`).
 * - Router wires one-liners only; no business logic here.
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

  // LIST
  r.get("/list", (req, res) => listCtl.get(req, res));

  // CREATE
  r.put("/create", (req, res) => createCtl.put(req, res));

  // UPDATE — canonical path-param form
  r.patch("/:envServiceId", (req, res) => updateCtl.patch(req, res));

  // READ — support query + param
  r.get("/read", (req, res) => readCtl.get(req, res));
  r.get("/read/:envServiceId", (req, res) => readCtl.get(req, res));

  // DELETE — support query + param + bare /:envServiceId (smoke #8 uses the bare form)
  r.delete("/delete", (req, res) => deleteCtl.delete(req, res));
  r.delete("/delete/:envServiceId", (req, res) => deleteCtl.delete(req, res));
  r.delete("/:envServiceId", (req, res) => deleteCtl.delete(req, res));

  return r;
}
