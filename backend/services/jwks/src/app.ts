// backend/services/jwks/src/app.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/app.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 — Versioned Health Envelope & Routes
 *   - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 *   - ADR-0034 — JWKS Service via GCP KMS, discovered by SvcFacilitator (internalOnly=true)
 *
 * Purpose (orchestration only):
 * - Inherit lifecycle and middleware order from AppBase:
 *   onBoot → health → preRouting → security → parsers → routes → postRouting
 * - Wire versioned health first; then mount JWKS routes.
 *
 * Invariants:
 * - Environment-invariant: no literals beyond the service slug; config is provided via env.
 * - No business logic here; controllers/providers/receivers live in their own files.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { JwksRouter } from "./routes/jwks.router";

const SERVICE_SLUG = "jwks";

export class JwksApp extends AppBase {
  constructor() {
    super({ service: SERVICE_SLUG });
  }

  /** Versioned health base path (required per SOP). */
  protected healthBasePath(): string | null {
    return `/api/${SERVICE_SLUG}/v1`;
  }

  /** Wire routes; all other middleware order inherited from AppBase. */
  protected mountRoutes(): void {
    // Mount JWKS v1 routes under the versioned base.
    this.app.use(`/api/${SERVICE_SLUG}/v1`, new JwksRouter().router());
  }
}
