// backend/services/gateway/src/routes/health.ts
/**
 * Docs:
 * - SOP: Versioned health endpoint; mounted before any middleware/proxy.
 *
 * Purpose:
 * - Provide canonical health for Gateway at exactly:
 *     GET /api/gateway/v1/health
 *
 * Semantics:
 * - Always 200 (liveness) with a readiness field so callers can choose strictness.
 * - `ready: true` only when svcconfig mirror has >= 1 entries.
 */

import { Router, Request, Response } from "express";
import os from "os";
import { getSvcConfig } from "../services/svcconfig/SvcConfig";

export function healthRouter(): Router {
  const r = Router();

  r.get("/health", (_req: Request, res: Response) => {
    const svc = getSvcConfig();
    const mirrorCount = svc.snapshot().length;

    res.status(200).json({
      ok: true, // liveness
      service: "gateway",
      version: 1,
      ready: mirrorCount > 0, // readiness signal
      mirrorCount,
      pid: process.pid,
      host: os.hostname(),
      uptimeSec: Math.floor(process.uptime()),
      time: new Date().toISOString(),
    });
  });

  return r;
}
