// backend/services/gateway/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
 *
 * Purpose:
 * - Build and configure the Express app (routes, middleware).
 * - Mount health first, then the generic API proxy.
 */

import type { Express } from "express";
import express = require("express");
import { mountServiceHealth } from "@nv/shared/health/mount";
import { ApiProxyRouter } from "./routes/proxy";

export class GatewayApp {
  private readonly app: Express;

  constructor() {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.disable("x-powered-by");
    this.app.use(express.json());

    // 1) Health first so it isn't captured by the generic /api proxy.
    mountServiceHealth(this.app, { service: "gateway" });

    // 2) Generic pass-through for /api/<slug>/v<#>/...
    //    This supports both versioned and (temporarily) unversioned URLs.
    this.app.use("/api", new ApiProxyRouter().router());
  }

  public get instance(): Express {
    return this.app;
  }
}
