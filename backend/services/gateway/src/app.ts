// backend/services/gateway/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR0001 (gateway svcconfig)
 *   - ADR0003 (gateway pushes mirror to svcfacilitator)
 *   - ADR0006 (Gateway Edge Logging — pre-audit, toggleable)
 *   - ADR0013 (Versioned Gateway Health — consistency with internal services)
 *
 * Purpose:
 * - Compose the Gateway Express app.
 * - Mount health FIRST (versioned), then local routes (if any), then the proxy LAST.
 *
 * Notes:
 * - Proxy only swaps origin (host:port) based on SvcConfig mirror — path/query unchanged.
 * - Never proxy gateway’s own endpoints; health is mounted before proxy.
 * - Health endpoints are VERSIONED for consistency: /api/gateway/v1/health/{live,ready}
 */

import type { Express } from "express";
import express = require("express");
import { mountServiceHealth } from "@nv/shared/health/mount";
import { makeProxy } from "./routes/proxy";
import { SvcConfig } from "./services/svcconfig/SvcConfig";
import { edgeHitLogger } from "./middleware/edge.hit.logger";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";

const SERVICE = "gateway";
const GATEWAY_VERSION = 1;

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
    //    Exposes: /api/gateway/v1/health/{live,ready}
    {
      const health = express.Router();
      mountServiceHealth(health, { service: SERVICE });
      this.app.use(`/api/${SERVICE}/v${GATEWAY_VERSION}/health`, health);
    }
    // 2) Edge logging — logs every inbound API hit before proxying
    this.app.use(edgeHitLogger());
    this.app.use(responseErrorLogger(SERVICE));

    // 3) Proxy LAST — origin swap only, path/query unchanged
    this.app.use("/api", makeProxy(this.svcConfig));
  }

  public get instance(): Express {
    return this.app;
  }
}
