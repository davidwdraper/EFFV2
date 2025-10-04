// backend/services/gateway/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR0001 (gateway svcconfig)
 *   - ADR0003 (gateway pushes mirror to svcfacilitator)
 *   - ADR0006 (Gateway Edge Logging — pre-audit, toggleable)
 *
 * Purpose:
 * - Compose the Gateway Express app.
 * - Mount health FIRST, then local routes (if any), then the proxy LAST.
 *
 * Notes:
 * - Proxy only swaps origin (host:port) based on SvcConfig mirror — path/query unchanged.
 * - Never proxy gateway’s own endpoints; health is mounted before proxy.
 */

import type { Express } from "express";
import express = require("express");
import { mountServiceHealth } from "@nv/shared/health/mount";
import { makeProxy } from "./routes/proxy";
import { SvcConfig } from "./services/svcconfig/SvcConfig";
import { edgeHitLogger } from "./middleware/edge.hit.logger"; // ← added

const SERVICE = "gateway";

export class GatewayApp {
  private readonly app: Express;
  private readonly svcConfig: SvcConfig;

  constructor(svcConfig?: SvcConfig) {
    this.app = express();
    this.svcConfig = svcConfig ?? new SvcConfig();
    this.configure();
  }

  private configure(): void {
    this.app.disable("x-powered-by");
    this.app.use(express.json());

    // 1) Health FIRST — never proxied
    //    Exposes: /api/gateway/health/{live,ready}
    mountServiceHealth(this.app, { service: SERVICE });

    // 2) (Optional) Any local gateway routes go here
    // this.app.use("/api/gateway", gatewayRouter());

    // 3) Edge logging — logs every inbound API hit before proxying
    this.app.use(edgeHitLogger());

    // 4) Proxy LAST — origin swap only, path/query unchanged
    this.app.use("/api", makeProxy(this.svcConfig));
  }

  public get instance(): Express {
    return this.app;
  }
}
