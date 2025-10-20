// backend/services/jwks/src/routes/jwks.router.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/routes/jwks.router.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0034 — JWKS Service via GCP KMS, discovered by SvcFacilitator (internalOnly=true)
 *
 * Purpose:
 * - Define versioned JWKS routes for the jwks service.
 * - **Routes are one-liners** per SOP: import handlers only; no logic here.
 *
 * Invariants:
 * - `/api/jwks/v1/keys` returns a **raw RFC 7517 JWK Set** (no NV envelope).
 * - Instrumentation handled in the controller; router stays declarative.
 */

import { Router } from "express";
import { JwksController } from "../controllers/JwksController";

export class JwksRouter {
  private readonly _router = Router();
  private readonly controller = new JwksController();

  router(): Router {
    // GET /api/jwks/v1/keys → raw JWK Set
    this._router.get("/keys", this.controller.keys());

    // (Future private routes mount here; keep this file one-liners only.)
    return this._router;
  }
}
