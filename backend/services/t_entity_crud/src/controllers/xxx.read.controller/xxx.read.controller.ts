/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Orchestrate GET /api/xxx/v1/read/:id (router mounts at /read/:id).
 * - Zero business logic: seed ctx → single handler → finalize.
 *
 * Invariants:
 * - Primary-key only. Canonical id field is "id". No fallbacks, no filters.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";
import { DbReadGetHandler } from "./handlers/dbRead.get.handler";

export class XxxReadController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    // Required inputs for the single handler — DTO ctor only (canonical id="id" is enforced in the handler).
    ctx.set("read.dtoCtor", XxxDto);

    await this.runPipeline(ctx, [new DbReadGetHandler(ctx)], {
      requireRegistry: false, // read-by-id path does not require the registry
    });

    return super.finalize(ctx);
  }
}
