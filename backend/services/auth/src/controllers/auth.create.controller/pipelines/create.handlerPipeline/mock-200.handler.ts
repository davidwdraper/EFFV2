// backend/services/auth/src/controllers/auth.create.controller/pipelines/auth.create.handlerPipeline/mock-200.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-only edges
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *
 * Purpose:
 * - Temporary MOS stub for auth.create().
 * - Return HTTP 200 with an **empty** DtoBag<AuthDto> on ctx["bag"].
 * - Used solely to validate gateway proxying and auth wiring while S2S
 *   Auth → User create is not yet implemented.
 *
 * Behavior:
 * - Constructs a DtoBag<AuthDto> with no items.
 * - Sets ctx["bag"] = bag and handlerStatus = "ok".
 * - Lets ControllerJsonBase.finalize() build the standard wire envelope.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { AuthDto } from "@nv/shared/dto/auth.dto";

export class Mock200AuthCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    // Empty bag is still a valid success payload — caller can treat it as
    // "auth create acknowledged" without relying on a DTO instance.
    const bag = new DtoBag<AuthDto>([]);

    this.ctx.set("bag", bag);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "mock_200",
        size: bag.size(),
      },
      "auth.mock200: returning stubbed 200 for auth.create (empty bag)"
    );
  }
}
