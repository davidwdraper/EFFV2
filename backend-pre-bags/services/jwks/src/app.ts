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
 *   - ADR-0017 — JWKS Service carve-out (policy/public route)
 *   - ADR-0035 — JWKS via GCP KMS with TTL Cache
 *
 * Purpose (orchestration only):
 * - Inherit lifecycle and middleware order from AppBase:
 *   onBoot → health → preRouting → security → parsers → routes → postRouting
 * - Wire versioned health first; then mount JWKS routes.
 *
 * Invariants:
 * - Environment-invariant: no literals beyond the service slug; config is provided via env.
 * - No business logic here; providers/cache/controller are composed in JwksModule.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { buildJwksRouter } from "./composition/JwksModule";

export class JwksApp extends AppBase {
  constructor() {
    super({ service: "jwks" });
  }

  /** Wire routes; all other middleware order inherited from AppBase. */
  protected mountRoutes(): void {
    // Mount JWKS v1 routes under the versioned base (auto from AppBase.healthBasePath()).
    this.app.use("/api/jwks/v1", buildJwksRouter());
  }
}
