// backend/services/svcfacilitator/src/routes/mirror.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0019 (Class Routers via RouterBase)
 *
 * Purpose:
 * - /mirror routes using RouterBase (class-based router with logging & guards).
 *
 * Invariants:
 * - Mounted under /api/svcfacilitator/v<major>
 * - All handlers require versioned API path and slug=svcfacilitator
 */

import type { Request, Response } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { MirrorController } from "../controllers/mirror.controller";

export class MirrorRouter extends RouterBase {
  private readonly ctrl = new MirrorController();

  protected configure(): void {
    this.router().post("/load", this.wrap(this.loadMirror));
  }

  private async loadMirror(req: Request, res: Response): Promise<void> {
    // Enforce canonical versioned path and correct slug
    if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

    // Delegate to controller (controller returns JSON-friendly payload)
    // If your controller currently writes directly to res, you can swap to:
    //   return void this.ctrl.mirrorLoad(req, res);
    const data = await this.ctrl.mirrorLoad(req, res as any);
    if (!res.headersSent) {
      // Standard envelope if controller returned data
      this.jsonOk(res, data ?? { status: "accepted" });
    }
  }
}
