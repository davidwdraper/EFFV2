// backend/services/gateway/src/routes/health.ts
/**
 * Docs:
 * - SOP: Versioned health endpoint; mounted BEFORE any middleware/proxy.
 * - ADRs:
 *   - ADR-0013 (Versioned Gateway Health — consistency with internal services)
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0015 (Logger with .bind())
 *
 * Purpose:
 * - Provide canonical health for Gateway at:
 *     GET /api/gateway/v1/health
 *
 * Contract (canonical envelope):
 * {
 *   ok: true,
 *   service: "gateway",
 *   data: {
 *     status: "live",
 *     detail: { uptime: number, host: string, pid: number, ready: boolean, mirrorCount: number }
 *   }
 * }
 *
 * Notes:
 * - This router is intended to be mounted at: /api/gateway/v1/health
 *   …and exposes GET "/" (not "/health").
 * - Readiness is a simple signal based on the svcconfig mirror having ≥ 1 entries.
 */

import { Router, type Request, type Response } from "express";
import os from "os";
import { ServiceBase } from "@nv/shared/base/RouterBase";
import { getSvcConfig } from "../services/svcconfig/SvcConfig";

export class GatewayHealthRouter extends ServiceBase {
  constructor() {
    super({ service: "gateway", context: { router: "health" } });
  }

  /** Build and return the Express router. */
  public router(): Router {
    const r = Router();
    const log = this.bindLog({ route: "/api/gateway/v1/health" });

    // GET /api/gateway/v1/health
    r.get("/", (_req: Request, res: Response) => {
      const svc = getSvcConfig();
      const mirrorCount = svc.snapshot().length;
      const ready = mirrorCount > 0;

      log.debug({ mirrorCount, ready }, "gateway health check");

      res.status(200).json({
        ok: true,
        service: "gateway",
        data: {
          status: "live",
          detail: {
            uptime: Math.floor(process.uptime()),
            host: os.hostname(),
            pid: process.pid,
            ready,
            mirrorCount,
          },
        },
      });
    });

    return r;
  }
}
