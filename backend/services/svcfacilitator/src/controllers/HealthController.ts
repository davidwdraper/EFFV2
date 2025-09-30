// backend/services/svcfacilitator/src/controllers/HealthController.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0002-svcfacilitator-minimal.md
 *
 * Purpose:
 * - Expose a simple health endpoint using shared HealthService (process-only).
 */

import type { Request, Response } from "express";
import { HealthService, ProcessCheck } from "@nv/shared";

export class HealthController {
  async getHealth(_req: Request, res: Response): Promise<void> {
    const svc = new HealthService("svcfacilitator");
    svc.add(new ProcessCheck({ critical: false }));

    const report = await svc.run();
    const http =
      report.status === "ok" ? 200 : report.status === "degraded" ? 200 : 503;
    res.status(http).json(report);
  }
}
