// backend/services/gateway/src/controllers/HealthController.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Gateway health endpoint using shared HealthService.
 * - Checks:
 *   - process (non-critical)
 *   - mongo ping (critical) via shared DbClient
 *   - svcconfig mirror presence (non-critical)
 */

import type { Request, Response } from "express";
import {
  HealthService,
  ProcessCheck,
  CallbackCheck,
  createDbClientFromEnv,
} from "@nv/shared";
import { getSvcConfig } from "../services/svcconfig";

export class HealthController {
  async getHealth(_req: Request, res: Response): Promise<void> {
    const svc = new HealthService("gateway");

    // Non-critical process snapshot
    svc.add(new ProcessCheck({ critical: false }));

    // Critical: DB ping (via DbClient built from SVCCONFIG_* or DB_*/MONGO_*)
    const dbClient = createDbClientFromEnv({ prefix: "SVCCONFIG" });
    svc.add(
      new CallbackCheck("mongo", true, async () => {
        const db: any = await dbClient.getDb(); // driver-specific
        await db.command({ ping: 1 });
      })
    );

    // Non-critical: svcconfig mirror sanity
    svc.add(
      new CallbackCheck("svcconfig-mirror", false, async () => {
        const mirror = getSvcConfig().getMirror();
        // Throw if mirror is suspiciously empty (but non-critical overall)
        if (Object.keys(mirror).length === 0) {
          throw new Error("mirror empty");
        }
      })
    );

    const report = await svc.run();
    const http =
      report.status === "ok" ? 200 : report.status === "degraded" ? 200 : 503;
    res.status(http).json(report);
  }
}
