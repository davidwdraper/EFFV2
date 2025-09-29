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
import { healthRouter } from "./routes/health";

export class GatewayApp {
  private readonly app: Express;

  constructor() {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.disable("x-powered-by");
    this.app.use(express.json());

    // Health should be top-level and fast
    this.app.use("/health", healthRouter());
  }

  public get instance(): Express {
    return this.app;
  }
}
