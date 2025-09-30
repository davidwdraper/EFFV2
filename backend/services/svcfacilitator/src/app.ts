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
import { healthRouter } from "./routes/Health";
import { mirrorRouter } from "./routes/mirror";

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

    // Mirror ops
    this.app.use("/mirror", mirrorRouter());
  }

  public get instance(): Express {
    return this.app;
  }
}
