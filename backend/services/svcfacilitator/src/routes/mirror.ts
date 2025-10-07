// backend/services/svcfacilitator/src/routes/mirror.ts
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
 */

import type { Request, Response } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
// NOTE: case-sensitive import to match the actual filename
import { MirrorController } from "../controllers/MirrorController";

export class MirrorRouter extends RouterBase {
  private readonly ctrl = new MirrorController();

  protected configure(): void {
    this.router().post("/mirror/load", this.wrap(this.loadMirror)); // keep explicit prefix
    // Back-compat path if you already mounted at /load previously:
    this.router().post("/load", this.wrap(this.loadMirror));
  }

  private async loadMirror(req: Request, res: Response): Promise<void> {
    if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

    const data = await this.ctrl.mirrorLoad(req, res as any);
    if (!res.headersSent) {
      this.jsonOk(res, data ?? { status: "accepted" });
    }
  }
}
