// backend/services/svcfacilitator/src/routes/mirror.router.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/routes/mirror.router.v2.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 — Base Hierarchy: ServiceEntrypoint vs ServiceBase
 *   - ADR-0015 — Structured Logger with bind() Context
 *   - ADR-0019 — Class Routers via RouterBase
 *   - ADR-0020 — SvcConfig Mirror & Push Design
 *
 * Purpose:
 * - /mirror routes using RouterBase (class-based router with logging & guards).
 *
 * Invariants:
 * - Mounted under /api/svcfacilitator/v<major>
 * - All handlers require versioned API path and slug=svcfacilitator
 * - No backward-compat paths (greenfield SOP)
 * - Routes are one-liners — import handlers only (DI for controller).
 */

import type { Request, Response } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { MirrorController } from "../controllers/MirrorController.v2";

export class MirrorRouterV2 extends RouterBase {
  constructor(private readonly ctrl: MirrorController) {
    super();
  }

  protected configure(): void {
    // Explicit canonical path only (no aliases)
    this.post("/mirror/load", (req: Request, res: Response) => {
      if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;
      // Delegate straight to controller; router stays glue-only
      void this.ctrl.mirrorLoad(req, res);
    });
  }
}
