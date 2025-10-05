// backend/services/svcfacilitator/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0002-svcfacilitator-minimal.md
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *
 * Purpose:
 * - Build and configure the Express app (routes, middleware).
 * - Health routes mounted via shared helper (no drift).
 * - Mount /api/svcfacilitator/{resolve,mirror} per URL convention.
 *
 * Route order (SOP):
 * - Health first
 * - Public API (resolve)
 * - Tooling (mirror)
 * - Global error handler
 */

import type { Express, Request, Response, NextFunction } from "express";
import express = require("express");
import { mountServiceHealth } from "@nv/shared/health/mount";
import { resolveRouter } from "./routes/resolve";
import { mirrorRouter } from "./routes/mirror";

const SERVICE = "svcfacilitator";

export class SvcFacilitatorApp {
  private readonly app: Express;

  constructor() {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.disable("x-powered-by");
    this.app.use(express.json());

    // 1) Health: /api/svcfacilitator/health/{live,ready}
    mountServiceHealth(this.app, { service: SERVICE });

    // 2) Resolution API (public): /api/svcfacilitator/resolve
    this.app.use("/api/svcfacilitator", resolveRouter());

    // 3) Mirror tooling (pushed by gateway): /api/svcfacilitator/mirror
    //    (was "/mirror" — corrected to follow URL convention)
    this.app.use("/api/svcfacilitator/mirror", mirrorRouter());

    // 4) Final JSON error handler (jq-safe)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        // Keep it loud until structured logger is wired here.
        console.error("[svcfacilitator:error]", err);
        res
          .status(500)
          .json({ type: "about:blank", title: "Internal Server Error" });
      }
    );
  }

  public get instance(): Express {
    return this.app;
  }
}
