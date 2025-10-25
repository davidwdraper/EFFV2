// backend/services/svcfacilitator/src/app.v2.ts
/**
 * NowVibin (NV)
 * File: backend/services/svcfacilitator/src/app.v2.ts
 *
 * Purpose:
 * - Orchestrates SvcFacilitator runtime. Defines order only; no business logic.
 * - Self-wires on first expressApp() call to avoid lifecycle ambiguity.
 *
 * Invariants (SOP):
 * - Health first, then parsers, then routes, then JSON 404, then problem middleware.
 * - Routes are mounted as one-liners; controllers/routers are injected.
 * - No env reads here; DI only.
 */

import express, { type Request, type Response } from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import type { Express } from "express";

// Routers (DI)
import { ResolveRouterV2 } from "./routes/resolve.router.v2";
import { MirrorRouterV2 } from "./routes/mirror.router.v2";

// Controllers (DI)
import { ResolveController } from "./controllers/ResolveController.v2";
import { MirrorController } from "./controllers/MirrorController.v2";

// Store (DI target used only for readiness check; app never constructs it)
import { MirrorStoreV2 } from "./services/mirrorStore.v2";

// Global error sink (must be last)
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

  private wired = false;

  constructor(deps: AppDeps) {
    super({ service: SERVICE });

    this.store = deps.store;
    this.resolveRouter = new ResolveRouterV2(deps.resolveController);
    this.mirrorRouter = new MirrorRouterV2(deps.mirrorController);
  }

  /** Public getter so bootstrap/entrypoint can hand Express to the HTTP server. */
  public expressApp(): Express {
    if (!this.wired) this.wireOnce();
    return this.app;
  }

  /** Health route base used for logs/consistency. */
  protected override healthBasePath(): string | null {
    return V1_BASE;
  }

  /** Readiness check for AppBase/startup logs (does not throw). */
  protected override readyCheck(): () => boolean {
    return () => {
      try {
        return (this.store.count?.() ?? 0) > 0;
      } catch {
        return false;
      }
    };
  }

  /** One-time wiring to avoid relying on implicit AppBase lifecycle. */
  private wireOnce(): void {
    // Health FIRST (versioned)
    this.app.get(`${V1_BASE}/health`, (_req: Request, res: Response) => {
      res
        .status(200)
        .type("application/json")
        .json({ ok: true, service: SERVICE });
    });

    // Parsers (after health)
    this.app.use(express.json({ limit: "1mb" }));

    // ---- V1 routes (order matters) ----
    this.app.use(V1_BASE, this.resolveRouter.router());
    this.app.use(V1_BASE, this.mirrorRouter.router());

    // Minimal diagnostic endpoint — returns combined mirror size only (no data dump)
    this.app.get(`${V1_BASE}/svcconfig/count`, (_req, res) => {
      const count = this.store.count?.() ?? 0;
      res
        .status(200)
        .type("application/json")
        .json({ ok: true, services: count });
    });

    // JSON 404 under V1 base — prevents Express HTML fall-through
    this.app.use(V1_BASE, (req: Request, res: Response) => {
      res
        .status(404)
        .type("application/problem+json")
        .json({
          type: "about:blank",
          title: "not_found",
          status: 404,
          detail: `No route for ${req.method} ${req.originalUrl}`,
        });
    });

    // MUST be last: global problem middleware
    this.app.use(problem);

    this.wired = true;
  }

  // We still override hooks to keep AppBase happy, but wiring is explicit above.
  protected override mountPreRouting(): void {}
  protected override mountSecurity(): void {}
  protected override mountRoutes(): void {}
  protected override mountPostRouting(): void {}
}
