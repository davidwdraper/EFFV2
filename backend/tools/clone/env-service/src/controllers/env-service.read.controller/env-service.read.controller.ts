// backend/services/env-service/src/controllers/env-service.read.controller/env-service.read.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Orchestrate GET /api/env-service/v1/read (router mounts at /read).
 * - Zero business logic: seed ctx → one handler → finalize.
 *
 * Invariants:
 * - Handler constructs its own DbReader with idFieldName="envServiceId".
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";

import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { DbReadGetHandler } from "./handlers/dbRead.get.handler";

export class EnvServiceReadController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    // Required inputs for the single handler
    ctx.set("read.dtoCtor", EnvServiceDto);
    ctx.set("read.idFieldName", "envServiceId");

    // Single, self-contained handler (constructs its own DbReader)
    const pipeline = [new DbReadGetHandler(ctx)];

    for (const h of pipeline) await h.run();
    return super.finalize(ctx);
  }
}
