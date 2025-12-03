// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/mockSuccess.handler.ts
/**
 * Docs:
 * - SOP: bag-only success responses
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *
 * Purpose:
 * - Temporary stub for auth.signup while S2S user + user-auth flows are not wired.
 * - Assumes ctx["bag"] holds a DtoBag<UserDto> from upstream handlers
 *   and simply marks the pipeline as successful.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";

export class MockSuccessHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const requestId = this.ctx.get("requestId");
    const bag = this.ctx.get<DtoBag<UserDto>>("bag");

    if (!bag) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "USER_BAG_MISSING",
        title: "Internal Error",
        detail:
          "MockSuccessHandler expected ctx['bag'] to contain a DtoBag<UserDto>, but it was missing. " +
          "Ops: treat this as a wiring bug in the auth.signup pipeline. " +
          "Dev: ensure HydrateUserBagHandler runs before this handler.",
        requestId,
      });

      this.log.error(
        {
          event: "user_bag_missing",
          handler: this.constructor.name,
          requestId,
        },
        "signup.mockSuccess: ctx['bag'] was missing"
      );
      return;
    }

    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "mock_success",
        requestId,
        bagSize: bag.size(),
      },
      "signup.mockSuccess: returning stubbed 200 for auth.signup with UserDto bag"
    );
  }
}
