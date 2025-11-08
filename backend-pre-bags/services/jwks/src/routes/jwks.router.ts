// backend/services/jwks/src/routes/jwks.router.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/routes/jwks.router.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0017 — JWKS Service carve-out (policy/public route)
 * - ADR-0035 — JWKS via GCP KMS with TTL Cache
 *
 * Purpose:
 * - Define versioned JWKS routes for the JWKS service.
 * - **Routes are one-liners** per SOP: import handlers only; no logic here.
 *
 * Invariants:
 * - `/api/jwks/v1/keys` returns a **raw RFC 7517 JWK Set** (no NV envelope).
 * - Router inherits RouterBase for lifecycle + logging; controller stays thin.
 */

import type { Router } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { JwksController } from "../controllers/JwksController";

export class JwksRouter extends RouterBase {
  constructor(private readonly controller: JwksController) {
    super({ service: "jwks", context: { component: "Router" } });
  }

  // One-liner route wiring only; all behavior lives in the controller.
  protected configure(): void {
    // GET /api/jwks/v1/keys → raw JWK Set
    this.get("/keys", this.controller.keys());
  }

  // Expose the express.Router instance after base lifecycle runs.
  public router(): Router {
    return super.router();
  }
}
