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
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint vs ServiceBase → AppBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0019 (Class Routers via RouterBase)
 *
 * Purpose:
 * - OO refactor: SvcFacilitatorApp extends AppBase → ServiceBase.
 * - Mount **versioned** health via shared helper at:
 *     /api/svcfacilitator/v1/health/{live,ready}
 * - Mount class-based routers (ResolveRouter, MirrorRouter) under versioned base.
 * - Keep versioned svcconfig read endpoint for gateway compatibility.
 *
 * Route order (SOP):
 * - Health first (versioned)
 * - Public API (resolve — versioned)
 * - Tooling (mirror — versioned)
 * - Versioned svcconfig read (compat)
 * - Global error handler (jq-safe)
 */

import type { Request, Response, NextFunction } from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { ResolveRouter } from "./routes/resolve";
import { MirrorRouter } from "./routes/mirror";
import { mirrorStore } from "./services/mirrorStore";

const SERVICE = "svcfacilitator";
const V1_BASE = "/api/svcfacilitator/v1";

export class SvcFacilitatorApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  /** Subclass hook from AppBase — mount routes/middleware here. */
  protected configure(): void {
    // 1) Versioned health per ADR-0013 — always mount first
    this.mountVersionedHealth(V1_BASE);

    // 2) Resolution API (versioned): /api/svcfacilitator/v1/resolve[/*]
    this.app.use(V1_BASE, new ResolveRouter({ service: SERVICE }).router());

    // 3) Mirror tooling (versioned): /api/svcfacilitator/v1/mirror/load
    this.app.use(V1_BASE, new MirrorRouter({ service: SERVICE }).router());

    // 4) Gateway compatibility: versioned svcconfig read
    //    GET /api/svcfacilitator/v1/svcconfig  → { ok, mirror, services }
    this.app.get(`${V1_BASE}/svcconfig`, (_req: Request, res: Response) => {
      const mirror = mirrorStore.getMirror?.() ?? {};
      res.status(200).json({
        ok: true,
        mirror,
        services: Object.keys(mirror).length,
      });
    });

    // 5) Final JSON error handler (jq-safe)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        // Loud until structured logger wired here per ADR-0015.
        // eslint-disable-next-line no-console
        console.error("[svcfacilitator:error]", err);
        res
          .status(500)
          .json({ type: "about:blank", title: "Internal Server Error" });
      }
    );
  }
}
