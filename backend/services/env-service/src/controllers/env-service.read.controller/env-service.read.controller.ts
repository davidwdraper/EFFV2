// backend/services/env-service/src/controllers/env-service.read.controller/env-service.read.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Orchestrate GET /api/env-service/v1/:dtoType/:op/:id?
 * - Thin controller: choose per-(dtoType,op) pipeline; pipeline defines handler order.
 *
 * Invariants:
 * - Primary-key read uses op="read" and requires :id.
 * - Config read uses op="config" and ignores :id (uses query: env, slug, version, level).
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (resolved via directory index.ts)
import * as EnvServiceReadPipeline from "./pipelines/env-service.read.handlerPipeline";
import * as EnvServiceConfigPipeline from "./pipelines/env-service.config.handlerPipeline";

export class EnvServiceReadController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;
    const op = (req.params.op || "read").trim();

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
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

    switch (dtoType) {
      case "env-service": {
        switch (op) {
          case "read": {
            const steps = EnvServiceReadPipeline.getSteps(ctx, this);
            await this.runPipeline(ctx, steps, { requireRegistry: false }); // read-by-id doesn’t need registry
            break;
          }
          case "config": {
            const steps = EnvServiceConfigPipeline.getSteps(ctx, this);
            await this.runPipeline(ctx, steps, { requireRegistry: false }); // config read uses EnvConfigReader directly
            break;
          }
          default: {
            ctx.set("handlerStatus", "error");
            ctx.set("response.status", 501);
            ctx.set("response.body", {
              code: "NOT_IMPLEMENTED",
              title: "Not Implemented",
              detail: `No read pipeline for dtoType='${dtoType}', op='${op}'`,
              requestId: ctx.get("requestId"),
            });
            this.log.warn(
              {
                event: "pipeline_missing",
                op,
                dtoType,
                requestId: ctx.get("requestId"),
              },
              "no read pipeline registered for dtoType/op"
            );
          }
        }
        break;
      }

      default: {
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
      }
    }

    return super.finalize(ctx);
  }
}
