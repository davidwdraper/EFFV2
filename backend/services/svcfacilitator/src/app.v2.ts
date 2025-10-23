// backend/services/svcfacilitator/src/app.v2.ts
/**
 * NowVibin (NV)
 * File: backend/services/svcfacilitator/src/app.v2.ts
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

// Controllers (DI)
import { ResolveController } from "./controllers/ResolveController.v2";
import { MirrorController } from "./controllers/MirrorController.v2";

// Store (DI target used only for readiness check; app never constructs it)
import { MirrorStoreV2 } from "./services/mirrorStore.v2";

// *** Global error sink (must be last) ***
import { problem } from "@nv/shared/middleware/problem";

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
    super.mountPreRouting(); // responseErrorLogger, etc.
  }

  /** TEMP security layer: public resolve bypass before verifyS2S (future). */
  protected mountSecurity(): void {
    // verifyS2S would go here later (after health); no-op for now.
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

  /** MUST be last: global error middleware that preserves controller status codes. */
  protected mountPostRouting(): void {
    this.app.use(problem);
  }
}
