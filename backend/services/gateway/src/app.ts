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

import express, { Express } from "express";
import { helloRouter } from "./routes/hello";

export class GatewayApp {
  private readonly app: Express;

  constructor() {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.disable("x-powered-by");
    this.app.use(express.json());
    this.app.use("/api/hello", helloRouter());
  }

  public get instance(): Express {
    return this.app;
  }
}
