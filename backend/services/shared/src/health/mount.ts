// backend/services/shared/src/health/mount.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *
 * Purpose:
 * - Mount health endpoints on an Express app or Router.
 * - Returns the canonical envelope:
 *     { ok:true, service, data:{ status:"live|ready|not_ready", detail?:{...} } }
 *
 * Routes (mounted at caller’s base):
 *   GET <base>/health/live
 *   GET <base>/health/ready
 */

import type { Express, Request, Response, Router } from "express";
import os from "os";
import { getLogger } from "../logger/Logger";

type MountTarget = Express | Router;

export interface HealthOptions {
  /** Service slug for logging context (e.g., "gateway", "svcfacilitator"). */
  service: string;
  /**
   * Optional readiness check. If provided, /health/ready returns 200 only when
   * this resolves to a truthy value; otherwise 503.
   */
  readyCheck?: () => Promise<boolean> | boolean;
}

export function mountServiceHealth(
  target: MountTarget,
  opts: HealthOptions
): void {
  const { service, readyCheck } = opts;
  const log = getLogger().bind({
    service,
    url: "/health",
    component: "mountServiceHealth",
  });

  // ── Liveness — process is alive if handler runs ────────────────────────────
  (target as any).get("/health/live", (_req: Request, res: Response) => {
    log.edge({ route: "live" }, "health/live hit");
    res.status(200).json({
      ok: true,
      service,
      data: {
        status: "live",
        detail: {
          uptime: Math.floor(process.uptime()),
          host: os.hostname(),
          pid: process.pid,
        },
      },
    });
  });

  // ── Readiness — optional readiness check ───────────────────────────────────
  (target as any).get("/health/ready", async (_req: Request, res: Response) => {
    try {
      log.debug({ route: "ready" }, "health/ready check start");

      if (!readyCheck) {
        log.info({ route: "ready", ready: true }, "no readyCheck provided");
        return res.status(200).json({
          ok: true,
          service,
          data: { status: "ready" },
        });
      }

      const ready = await readyCheck();
      if (ready) {
        log.info({ route: "ready", ready: true }, "service ready");
        return res.status(200).json({
          ok: true,
          service,
          data: { status: "ready" },
        });
      }

      log.warn({ route: "ready", ready: false }, "service not ready");
      return res.status(503).json({
        ok: false,
        service,
        data: { status: "not_ready" },
      });
    } catch (e) {
      log.error({ route: "ready", err: String(e) }, "ready_check_error");
      return res.status(503).json({
        ok: false,
        service,
        data: { status: "not_ready" },
      });
    }
  });
}
