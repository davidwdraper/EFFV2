// backend/services/auth/src/routes/auth.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; WAL-first writes)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="_id")
 *   - ADR-0056 (Typed routes use :dtoType on all CRUD operations)
 *
 * Purpose:
 * - Auth service CREATE endpoint only.
 * - Wires versioned RESTful route:
 *     PUT /api/auth/v1/:dtoType/create
 *
 * Invariants:
 * - Router stays one-liner thin; no business logic.
 * - Controllers are constructed exactly once.
 * - :dtoType must be a valid registry key.
 * - All other CRUD routes intentionally omitted per session scope.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { AuthCreateController } from "../controllers/auth.create.controller/auth.create.controller";

export function buildAuthRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Controller constructed once only
  const createCtl = new AuthCreateController(app);

  // CREATE (PUT /:dtoType/create)
  r.put("/:dtoType/create", (req, res) => createCtl.put(req, res));

  return r;
}
