// backend/services/svcfacilitator/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0002-svcfacilitator-minimal.md
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *   - ADR-0013 (Versioned Health Envelope; versioned health routes)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0019 (Class Routers via RouterBase)
 *   - ADR-0038 (Route Policy Gate & Facilitator Endpoints)
 *
 * Purpose:
 * - SvcFacilitatorApp inherits base ordering from AppBase.
 * - Health (versioned) first; base pre/security/parsers; service routes; error funnel.
 * - Adds versioned routePolicy endpoints (mocked controllers for Step #3).
 */

import type { Request, Response } from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { ResolveRouter } from "./routes/resolve.router";
import { MirrorRouter } from "./routes/mirror.router";
import { RoutePolicyRouter } from "./routes/routePolicy.router";
import { mirrorStore } from "./services/mirrorStore";

const SERVICE = "svcfacilitator";
const V1_BASE = "/api/svcfacilitator/v1";

export class SvcFacilitatorApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  protected healthBasePath(): string | null {
    return V1_BASE;
  }

  protected mountRoutes(): void {
    // 1) Resolution API
    this.app.use(V1_BASE, new ResolveRouter({ service: SERVICE }).router());

    // 2) Mirror tooling
    this.app.use(V1_BASE, new MirrorRouter({ service: SERVICE }).router());

    // 3) RoutePolicy endpoints (mocked controllers for Step #3)
    this.app.use(V1_BASE, new RoutePolicyRouter({ service: SERVICE }).router());

    // 4) Gateway compatibility: versioned svcconfig read
    this.app.get(`${V1_BASE}/svcconfig`, (_req: Request, res: Response) => {
      const mirror = mirrorStore.getMirror?.() ?? {};
      res.status(200).json({
        ok: true,
        mirror,
        services: Object.keys(mirror).length,
      });
    });
  }
}
