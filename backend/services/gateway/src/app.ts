// backend/services/gateway/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
 *
 * Purpose:
 * - Build and configure the Express app (routes, middleware).
 */

import type { Express } from "express";
import express = require("express");
import { mountServiceHealth } from "@nv/shared/health/mount";
export class GatewayApp {
  private readonly app: Express;

  constructor() {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.disable("x-powered-by");
    this.app.use(express.json());

    // Shared health: canonical, no drift
    mountServiceHealth(this.app, { service: "gateway" });
  }

  public get instance(): Express {
    return this.app;
  }
}
