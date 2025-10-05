// backend/services/shared/src/health/mount.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Mount health endpoints on either an Express app OR an Express Router.
 * - Keeps gateway health “gateway-specific” and never proxied, while allowing
 *   versioned mounts like /api/gateway/v1/health/{live,ready}.
 *
 * Routes (mounted at the caller’s base):
 *   GET <base>/health/live   → 200 if process is alive
 *   GET <base>/health/ready  → 200 if readyCheck() resolves truthy; else 503
 *
 * Usage:
 *   // Versioned, service-scoped health on a Router:
 *   const r = express.Router();
 *   mountServiceHealth(r, { service: "gateway" });
 *   app.use("/api/gateway/v1", r);
 *
 *   // Or directly on an Express app:
 *   mountServiceHealth(app, { service: "svcfacilitator" });
 */

import type { Express, Request, Response, Router } from "express";
import { getLogger } from "../util/logger.provider";

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
  const log = getLogger().bind({ slug: service, version: 1, url: "/health" });

  // Liveness — if we can run handler code, the process is alive.
  (target as any).get("/health/live", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, service, status: "live" });
  });

  // Readiness — caller controls with an optional check (DB, deps, etc.)
  (target as any).get("/health/ready", async (_req: Request, res: Response) => {
    try {
      if (!readyCheck) {
        return res.status(200).json({ ok: true, service, status: "ready" });
      }
      const ready = await readyCheck();
      if (ready) {
        return res.status(200).json({ ok: true, service, status: "ready" });
      }
      return res.status(503).json({ ok: false, service, status: "not_ready" });
    } catch (e) {
      log.warn(`ready_check_error - ${String(e)}`);
      return res.status(503).json({ ok: false, service, status: "not_ready" });
    }
  });
}
