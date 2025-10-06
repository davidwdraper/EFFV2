// backend/services/gateway/src/routes/health.ts
/**
 * Docs:
 * - SOP: Versioned health endpoint; mounted before any middleware/proxy.
 * - ADR0013: Versioned Gateway Health — consistency with internal services.
 *
 * Purpose:
 * - Provide canonical health for Gateway at exactly:
 *     GET /api/gateway/v1/health
 *
 * Contract (canonical envelope):
 * {
 *   ok: true,
 *   service: "gateway",
 *   data: {
 *     status: "live",
 *     detail: { uptime: number, ready: boolean, mirrorCount: number }
 *   }
 * }
 *
 * Notes:
 * - This router is intended to be mounted at: /api/gateway/v1/health
 *   …and exposes GET "/" (not "/health").
 * - Readiness is a simple signal based on the svcconfig mirror having ≥ 1 entries.
 */

import { Router, Request, Response } from "express";
import os from "os";
import { getSvcConfig } from "../services/svcconfig/SvcConfig";
import { getLogger } from "@nv/shared/util/logger.provider";

export function healthRouter(): Router {
  const r = Router();
  const log = getLogger();

  log.debug("enter -> healthRouter()");

  // GET /api/gateway/v1/health
  r.get("/", (_req: Request, res: Response) => {
    log.debug("enter -> healthRouter.get()");

    const svc = getSvcConfig();
    const mirrorCount = svc.snapshot().length;
    const ready = mirrorCount > 0;

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

  log.debug("exit -> healthRouter. Response: " + r);
  return r;
}
