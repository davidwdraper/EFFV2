// backend/services/env-service/src/controllers/read.controller/read.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (DbEnvServiceDto — Key/Value Contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Orchestrate GET /api/env-service/v1/:dtoType/config
 * - Thin controller: config-only; no op switching.
 *
 * Invariants:
 * - Config read always uses op="config" (query: env, slug, version, level).
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (resolved via directory index.ts)
import * as EnvServiceConfigPipeline from "./pipelines/config.pipeline";

export class EnvServiceReadController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;
    const op = "config";

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoKey", dtoType);
    ctx.set("op", op);

    this.log.debug(
      {
        event: "pipeline_select",
        op,
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "selecting read pipeline"
    );

    if (dtoType !== "env-service") {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 501);
      ctx.set("response.body", {
        code: "NOT_IMPLEMENTED",
        title: "Not Implemented",
        detail: `No read pipeline for dtoType='${dtoType}'`,
        requestId: ctx.get("requestId"),
      });
      this.log.warn(
        {
          event: "pipeline_missing_dtoType",
          op,
          dtoType,
          requestId: ctx.get("requestId"),
        },
        "no read pipeline registered for dtoType"
      );
      return super.finalize(ctx);
    }

    const steps = EnvServiceConfigPipeline.getSteps(ctx, this);
    await this.runPipeline(ctx, steps, { requireRegistry: false }); // config read uses EnvConfigReader directly

    return super.finalize(ctx);
  }
}
