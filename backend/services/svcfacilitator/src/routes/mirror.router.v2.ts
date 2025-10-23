// backend/services/svcfacilitator/src/routes/mirror.router.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/routes/mirror.router.v2.ts
 *
 * Purpose
 * - Expose the current in-memory service-config mirror (read-only).
 * - Canonical response: { mirror: { "<slug>@<version>": ServiceConfigRecordJSON } }
 *
 * Notes
 * - Do NOT swallow controller errors here. Let them bubble so global `problem` middleware
 *   can emit the exact { status, body } thrown by the controller.
 */

import type { Request, Response } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { MirrorController } from "../controllers/MirrorController.v2";

export class MirrorRouterV2 extends RouterBase {
  constructor(private readonly controller: MirrorController) {
    super({ service: "svcfacilitator" });
  }

  protected configure(): void {
    // GET /api/svcfacilitator/v1/mirror
    this.get("/mirror", async (_req: Request, res: Response) => {
      // If controller throws {status, body}, RouterBase.wrap will forward to `next(err)`
      // and the global problem middleware will format the response.
      const snapshot = await this.controller.getMirror();
      res.status(200).json({ mirror: snapshot });
    });
  }
}
