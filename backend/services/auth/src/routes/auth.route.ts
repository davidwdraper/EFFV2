// backend/services/auth/src/routes/auth.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; WAL-first writes)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="_id")
 *   - ADR-0056 (Typed routes use :dtoType on all CRUD-like operations)
 *
 * Purpose:
 * - Auth service SIGNUP endpoint.
 * - Wires versioned RESTful route:
 *     PUT /api/auth/v1/:dtoType/signup
 *
 * Invariants:
 * - Router stays one-liner thin; no business logic.
 * - Controllers are constructed exactly once.
 * - :dtoType must be a valid registry key.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { AuthSignupController } from "../controllers/auth.signup.controller/auth.signup.controller";

export function buildAuthRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  // Controller constructed once only
  const signupCtl = new AuthSignupController(app);

  // SIGNUP (PUT /:dtoType/signup)
  r.put("/:dtoType/signup", (req, res) => signupCtl.put(req, res));

  return r;
}
