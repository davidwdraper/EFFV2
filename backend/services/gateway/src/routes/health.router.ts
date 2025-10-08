// backend/services/gateway/src/routes/health.router.ts
/**
 * Docs:
 * - SOP: Versioned health endpoint; mounted BEFORE any middleware/proxy.
 * - ADRs:
 *   - ADR-0013 (Versioned Gateway Health — local, never proxied)
 *   - ADR-0014 (Base Hierarchy)
 *   - ADR-0015 (Logger with .bind())
 *
 * Purpose:
 * - Canonical health for Gateway at /api/gateway/v1/health
 * - Exposes:
 *     GET /        → summary (live + ready + detail)
 *     GET /live    → liveness (always 200)
 *     GET /ready   → readiness (200 if ready, 503 otherwise)
 *
 * Environment Invariance:
 * - No host/IP literals; host derives from NV_HOSTNAME or system.
 */

import os from "os";
import type { Request, Response } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { getSvcConfig } from "../services/svcconfig/SvcConfig";

export class GatewayHealthRouter extends RouterBase {
  constructor() {
    super({ service: "gateway", context: { router: "health" } });
  }

  private snapshot() {
    const svc = getSvcConfig();
    const mirrorCount = svc.snapshot().length;
    const ready = mirrorCount > 0;
    const host = process.env.NV_HOSTNAME || os.hostname();
    return {
      ready,
      mirrorCount,
      host,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
    };
  }

  protected configure(): void {
    // GET /
    this.get("/", (_req: Request, res: Response) => {
      const s = this.snapshot();
      return this.jsonOk(res, {
        status: "live",
        ready: s.ready,
        detail: {
          uptime: s.uptime,
          host: s.host,
          pid: s.pid,
          mirrorCount: s.mirrorCount,
        },
      });
    });

    // GET /live — always 200
    this.get("/live", (_req: Request, res: Response) => {
      return this.jsonOk(res, { status: "live" });
    });

    // GET /ready — 200 if ready, 503 otherwise
    this.get("/ready", (_req: Request, res: Response) => {
      const s = this.snapshot();
      if (s.ready) {
        return this.jsonOk(res, {
          status: "ready",
          mirrorCount: s.mirrorCount,
        });
      }
      return this.jsonProblem(res, 503, "not_ready", {
        mirrorCount: s.mirrorCount,
      });
    });
  }
}
