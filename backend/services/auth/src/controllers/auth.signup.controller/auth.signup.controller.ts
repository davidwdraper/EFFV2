// backend/services/auth/src/controllers/auth.signup.controller/auth.signup.controller.ts
/**
 * Docs:
 * - SOP: DTO-first; controller orchestrates, handlers do the work
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="_id")
 *
 * Purpose:
 * - Orchestrate:
 *     PUT /api/auth/v1/:dtoType/signup
 * - For now, only dtoType="user" is supported.
 *
 * Invariants:
 * - Edge payload is a wire bag envelope: { items: [ { type:"user", ... } ], meta?: {...} }.
 * - Signup requires exactly 1 UserDto item; enforced in pipeline handlers.
 * - Controller stays thin: selects pipeline, runs it, finalizes via ControllerJsonBase.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import * as SignupPipeline from "./pipelines/signup.handlerPipeline";

export class AuthSignupController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async put(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "signup");

    this.log.debug(
      {
        event: "pipeline_select",
        op: "signup",
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "auth.signup: selecting signup pipeline"
    );

    switch (dtoType) {
      case "user": {
        const steps = SignupPipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, {
          requireRegistry: true,
        });
        break;
      }

      default: {
        // Seed a clear 501 problem into the context (ControllerJsonBase.finalize will serialize).
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 501);
        ctx.set("response.body", {
          code: "NOT_IMPLEMENTED",
          title: "Not Implemented",
          detail: `No signup pipeline for dtoType='${dtoType}' on auth service.`,
          requestId: ctx.get("requestId"),
        });

        this.log.warn(
          {
            event: "pipeline_missing",
            op: "signup",
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "auth.signup: no signup pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
