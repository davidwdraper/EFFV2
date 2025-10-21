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
 *   - ADR-0037 — (UPCOMING) RoutePolicyGate decides S2S public/private
 *
 * Purpose:
 * - Orchestrates SvcFacilitator runtime. Defines order only; no business logic.
 * - Lifecycle/middleware order from AppBase:
 *     onBoot → health → preRouting → security → parsers → routes → postRouting
 *
 * Notes:
 * - TEMP: public bypass for GET /api/svcfacilitator/v1/resolve (env-guarded).
 * - TEMP: debug inbound headers to prove auth/no-auth and path.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { ResolveRouter } from "./routes/resolve.router";
import { MirrorRouter } from "./routes/mirror.router";
import { RoutePolicyRouter } from "./routes/routePolicy.router";
import { mirrorStore } from "./services/mirrorStore";
import { publicResolveBypass } from "./middleware/public.resolve.bypass"; // TEMP — remove post ADR-0037
import { debugInboundHeaders } from "./middleware/debug.inbound.headers"; // TEMP — remove after green

const SERVICE = "svcfacilitator";
const V1_BASE = `/api/${SERVICE}/v1`;

export class SvcFacilitatorApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  protected healthBasePath(): string | null {
    return V1_BASE;
  }

  protected readyCheck(): () => boolean {
    return () => Object.keys(mirrorStore.getMirror?.() ?? {}).length > 0;
  }

  /** Pre-routing: run the header echo before any gates. */
  protected mountPreRouting(): void {
    super.mountPreRouting(); // responseErrorLogger
    this.app.use(debugInboundHeaders(this.log));
  }

  /** TEMP security layer: public resolve bypass before verifyS2S (when introduced). */
  protected mountSecurity(): void {
    this.app.use(publicResolveBypass(this.log));
    // NOTE: verifyS2S would be mounted AFTER this (future), and should no-op if (req as any).nvIsPublic === true
  }

  protected mountRoutes(): void {
    this.app.use(V1_BASE, new ResolveRouter({ service: SERVICE }).router());
    this.app.use(V1_BASE, new MirrorRouter({ service: SERVICE }).router());
    this.app.use(V1_BASE, new RoutePolicyRouter({ service: SERVICE }).router());

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
