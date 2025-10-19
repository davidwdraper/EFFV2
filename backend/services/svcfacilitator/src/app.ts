// backend/services/svcfacilitator/src/app.ts
/**
 * NowVibin (NV)
 * File: backend/services/svcfacilitator/src/app.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0002 — SvcFacilitator Minimal (purpose & bootstrap)
 *   - ADR-0007 — SvcConfig Contract (fixed shapes & keys)
 *   - ADR-0008 — SvcFacilitator LKG (boot resilience when DB is down)
 *   - ADR-0013 — Versioned Health Envelope; versioned health routes
 *   - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 *   - ADR-0015 — Structured Logger with bind() Context
 *   - ADR-0019 — Class Routers via RouterBase
 *   - ADR-0038 — Route Policy Gate & Facilitator Endpoints
 *
 * Purpose:
 * - Orchestrates SvcFacilitator runtime. Defines order only; no business logic.
 * - Inherits full lifecycle and middleware order from AppBase:
 *     onBoot → health → preRouting → security → parsers → routes → postRouting
 * - Health endpoints are versioned and mounted automatically by AppBase.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { ResolveRouter } from "./routes/resolve.router";
import { MirrorRouter } from "./routes/mirror.router";
import { RoutePolicyRouter } from "./routes/routePolicy.router";
import { mirrorStore } from "./services/mirrorStore";

const SERVICE = "svcfacilitator";
const V1_BASE = `/api/${SERVICE}/v1`;

export class SvcFacilitatorApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  /** Versioned health base path (mounted first by AppBase). */
  protected healthBasePath(): string | null {
    return V1_BASE;
  }

  /** Ready when in-memory mirror has been hydrated. */
  protected readyCheck(): () => boolean {
    return () => Object.keys(mirrorStore.getMirror?.() ?? {}).length > 0;
  }

  /** Wire routers — resolution, mirror, routePolicy, and svcconfig introspection. */
  protected mountRoutes(): void {
    this.app.use(V1_BASE, new ResolveRouter({ service: SERVICE }).router());
    this.app.use(V1_BASE, new MirrorRouter({ service: SERVICE }).router());
    this.app.use(V1_BASE, new RoutePolicyRouter({ service: SERVICE }).router());

    // Compatibility endpoint for gateway mirror introspection
    this.app.get(`${V1_BASE}/svcconfig`, (_req, res) => {
      const mirror = mirrorStore.getMirror?.() ?? {};
      res.status(200).json({
        ok: true,
        mirror,
        services: Object.keys(mirror).length,
      });
    });
  }
}
