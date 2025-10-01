// backend/services/svcfacilitator/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0002-svcfacilitator-minimal.md
 *
 * Purpose:
 * - Build and configure the Express app (routes, middleware).
 * - Health routes mounted via shared helper (no drift).
 */

import type { Express, Request, Response, NextFunction } from "express";
import express = require("express");
import { mountServiceHealth } from "@nv/shared/health/mount";
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

    // Canonical health: /api/svcfacilitator/health/{live,ready}
    mountServiceHealth(this.app, { service: SERVICE });

    // Tooling
    this.app.use("/mirror", mirrorRouter());

    // Final JSON error handler (jq-safe)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
