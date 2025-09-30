// backend/services/svcfacilitator/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0002-svcfacilitator-minimal.md
 *
 * Purpose:
 * - Build and configure the Express app (routes, middleware).
 */

import type { Express } from "express";
import express = require("express");
import { healthRouter } from "./routes/health";

export class SvcFacilitatorApp {
  private readonly app: Express;

  constructor() {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.disable("x-powered-by");
    this.app.use(express.json());

    // Health
    this.app.use("/health", healthRouter());

    // Step 2: we'll add /mirror/load and /svc/:slug/url here.
  }

  public get instance(): Express {
    return this.app;
  }
}
