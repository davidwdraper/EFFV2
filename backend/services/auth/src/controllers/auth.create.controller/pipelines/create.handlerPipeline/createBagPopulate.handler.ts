// backend/services/auth/src/controllers/auth.create.controller/pipelines/create.handlerPipeline/createBagPopulate.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-only success responses
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; DTO as wire authority)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *
 * Purpose:
 * - Take the hydrated AuthDto from ctx["authDto"] and build a singleton DtoBag
 *   on ctx["bag"], so ControllerJsonBase.finalize() can return a bag-only success.
 *
 * Inputs (ctx):
 * - "authDto": AuthDto   (from CreateAuthDtoHandler)
 * - "requestId": string  (optional but recommended)
 *
 * Outputs (ctx):
 * - "bag": DtoBag (singleton; holds the AuthDto instance)
 * - "handlerStatus": "ok" | "error"
 *
 * Error (ctx):
 * - "handlerStatus": "error"
 * - "response.status": 5xx
 * - "response.body": ProblemDetails-like payload with Ops guidance
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { AuthDto } from "@nv/shared/dto/auth.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";

export class AuthCreateBagPopulateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const rawRequestId = this.ctx.get("requestId");
    const requestId =
      typeof rawRequestId === "string" && rawRequestId.trim().length > 0
        ? rawRequestId.trim()
        : "unknown";

    const authDto = this.ctx.get<AuthDto>("authDto");

    if (!authDto) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "AUTH_DTO_MISSING_FOR_BAG",
        title: "Internal Error",
        detail:
          "AuthCreateBagPopulateHandler expected ctx['authDto'] to contain a hydrated AuthDto, but it was missing. " +
          "Ops: treat this as a wiring bug in the auth.create pipeline. " +
          "Dev: ensure CreateAuthDtoHandler runs before this handler and sets ctx['authDto'].",
        requestId,
      });

      this.log.error(
        {
          event: "auth_dto_missing_for_bag",
          handler: this.constructor.name,
        },
        "AuthCreateBagPopulateHandler aborted — ctx['authDto'] was missing"
      );
      return;
    }

    // Build a singleton DtoBag with minimal, but valid, meta.
    const { bag } = BagBuilder.fromDtos([authDto], {
      requestId,
      limit: 1,
      total: 1,
      cursor: null,
    });

    this.ctx.set("bag", bag);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "auth_bag_populated",
        requestId,
      },
      "AuthCreateBagPopulateHandler — populated ctx['bag'] with singleton AuthDto bag"
    );
  }
}
