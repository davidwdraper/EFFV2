// backend/services/svcfacilitator/src/routes/mirror.router.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0019 (Class Routers via RouterBase)
 *   - ADR-0020 (SvcConfig Mirror & Push Design)
 *
 * Purpose:
 * - /mirror routes using RouterBase (class-based router with logging & guards).
 *
 * Invariants:
 * - Mounted under /api/svcfacilitator/v<major>
 * - All handlers require versioned API path and slug=svcfacilitator
 * - No backward-compat paths (greenfield SOP)
 */

import type { Request, Response } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { MirrorController } from "../controllers/MirrorController";

export class MirrorRouter extends RouterBase {
  private readonly ctrl = new MirrorController();

  protected configure(): void {
    // Explicit canonical path only (no /load alias)
    this.post("/mirror/load", this.loadMirror);
  }

  private async loadMirror(req: Request, res: Response): Promise<void> {
    if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

    const data = await this.ctrl.mirrorLoad(req, res);
    if (!res.headersSent) {
      this.jsonOk(res, data ?? { status: "accepted" });
    }
  }
}
