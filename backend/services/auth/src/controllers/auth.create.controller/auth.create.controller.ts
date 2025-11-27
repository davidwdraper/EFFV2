// backend/services/auth/src/controllers/auth.create.controller/auth.create.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="_id")
 *
 * Purpose:
 * - Orchestrate PUT /api/auth/v1/:dtoType/create
 * - Thin controller: choose per-dtoType pipeline; pipeline defines handler order.
 *
 * Invariants:
 * - Edge payload is a wire bag envelope: { items: [ { type:"<dtoType>", ... } ], meta?: {...} }.
 * - Create requires exactly 1 DTO item; enforced in pipeline handlers.
 * - No DB work here; this controller delegates to handlers (and eventually SvcClient) only.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one folder per dtoType)
import * as AuthCreatePipeline from "./pipelines/create.handlerPipeline";

export class AuthCreateController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async put(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "create");

    this.log.debug(
      {
        event: "pipeline_select",
        op: "create",
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "auth.create: selecting create pipeline"
    );

    switch (dtoType) {
      case "auth": {
        // NOTE:
        // - No DB work for this flow.
        // - Pipeline handlers will:
        //   1) Validate + hydrate AuthDto from wire bag envelope.
        //   2) (Stub) Call user service via future SvcClient v3 to create the backing user.
        const steps = AuthCreatePipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, {
          requireRegistry: true,
        });
        break;
      }

      default: {
        // Seed a clear 501 problem into the context (ControllerBase.finalize will serialize).
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 501);
        ctx.set("response.body", {
          code: "NOT_IMPLEMENTED",
          title: "Not Implemented",
          detail: `No create pipeline for dtoType='${dtoType}' on auth service.`,
          requestId: ctx.get("requestId"),
        });

        this.log.warn(
          {
            event: "pipeline_missing",
            op: "create",
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "auth.create: no create pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
