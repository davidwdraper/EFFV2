// backend/services/svcfacilitator/src/app.v2.ts
/**
 * NowVibin (NV)
 * File: backend/services/svcfacilitator/src/app.v2.ts
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
 *   - ADR-0037 — RoutePolicyGate decides S2S public/private (future)
 *
 * Purpose:
 * - Orchestrates SvcFacilitator runtime. Defines order only; no business logic.
 * - Lifecycle/middleware order from AppBase:
 *     onBoot → health → preRouting → security → parsers → routes → postRouting
 *
 * Invariants:
 * - No env reads. No service construction. DI only.
 * - Routes are mounted as one-liners; controllers/routers are injected.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import type { Router } from "express";

// v2 routers (DI)
import { ResolveRouterV2 } from "./routes/resolve.router.v2";
import { MirrorRouterV2 } from "./routes/mirror.router.v2";

// Controller types (for DI clarity)
import { ResolveController } from "./controllers/ResolveController.v2";
import { MirrorController } from "./controllers/MirrorController.v2";

// Store (DI target used only for readiness check; app never constructs it)
import { MirrorStoreV2 } from "./services/mirrorStore.v2";

const SERVICE = "svcfacilitator";
const V1_BASE = `/api/${SERVICE}/v1`;

type AppDeps = {
  store: MirrorStoreV2;
  resolveController: ResolveController;
  mirrorController: MirrorController;
};

export class SvcFacilitatorApp extends AppBase {
  private readonly store: MirrorStoreV2;
  private readonly resolveRouter: ResolveRouterV2;
  private readonly mirrorRouter: MirrorRouterV2;

  /**
   * DI-only constructor. Callers must construct controllers/stores elsewhere.
   * No env reads or service construction here.
   */
  constructor(deps: AppDeps) {
    super({ service: SERVICE });

    this.store = deps.store;

    // Routers are glue-only; we inject controllers
    this.resolveRouter = new ResolveRouterV2(deps.resolveController);
    this.mirrorRouter = new MirrorRouterV2(deps.mirrorController);
  }

  protected healthBasePath(): string | null {
    return V1_BASE;
  }

  protected readyCheck(): () => boolean {
    // Dev ≈ Prod behavior: readiness depends on an in-memory mirror snapshot being present.
    return () => {
      try {
        return (this.store.count?.() ?? 0) > 0;
      } catch {
        return false;
      }
    };
  }

  /** Pre-routing: run the header echo before any gates. */
  protected mountPreRouting(): void {
    super.mountPreRouting(); // responseErrorLogger
  }

  /** TEMP security layer: public resolve bypass before verifyS2S (when introduced). */
  protected mountSecurity(): void {
    // this.app.use(publicResolveBypass(this.log));
    // NOTE: verifyS2S would be mounted AFTER this (future),
    // and should no-op if (req as any).nvIsPublic === true
  }

  protected mountRoutes(): void {
    // Versioned base; one-liner mounting; no side effects
    this.app.use(V1_BASE, this.resolveRouter.router());
    this.app.use(V1_BASE, this.mirrorRouter.router());

    // Minimal diagnostic endpoint — returns combined mirror size only (no data dump)
    this.app.get(`${V1_BASE}/svcconfig/count`, (_req, res) => {
      const count = this.store.count?.() ?? 0;
      res.status(200).json({ ok: true, services: count });
    });
  }
}
