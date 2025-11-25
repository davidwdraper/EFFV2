// backend/services/auth/src/controllers/auth.create.controller/callUserCreate.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; S2S calls via SvcClient
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; DTO as wire authority)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0044 (EnvServiceDto as DTO — key/value env contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0052 (S2S via ServiceClient) — future alignment
 *
 * Purpose:
 * - (Future) Call the User service "create" endpoint via SvcClient v3, using svcconfig discovery.
 * - (Current round) Stub only: signal NOT_IMPLEMENTED clearly to callers and Ops.
 *
 * Inputs (ctx):
 * - "authDto": AuthDto (from CreateAuthDtoHandler)
 * - "requestId": string
 *
 * Outputs (current stub behavior):
 * - "handlerStatus": "error"
 * - "response.status": 501
 * - "response.body": ProblemDetails-like NOT_IMPLEMENTED payload
 *
 * Future behavior (non-stub):
 * - Use SvcClient to resolve slug="user" via svcconfig.
 * - Call PUT /api/user/v1/auth/create (or chosen dtoType/path) with a wire bag envelope.
 * - Map User service response into ctx["bag"] for finalize().
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

export class CallUserCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug(
      { event: "execute_enter" },
      "auth.callUserCreate: enter handler (stub)"
    );

    const requestId = this.ctx.get("requestId");
    const dtoType = this.ctx.get<string>("dtoType");

    // NOTE:
    // - SvcClient v3 is not yet implemented in this backend refactor.
    // - Rather than silently succeed or fake a response, we fail loudly with a clear 501.
    // - This keeps the surface wired and testable while forcing us to finish S2S correctly.
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("response.status", 501);
    this.ctx.set("response.body", {
      code: "AUTH_USER_CREATE_NOT_IMPLEMENTED",
      title: "Not Implemented",
      detail:
        "Auth create endpoint is wired but the SvcClient-backed call to the User service has not been implemented yet. Ops: endpoint is expected to return 501 until SvcClient v3 + svcconfig wiring is complete.",
      requestId,
      hint: "Dev: implement SvcClient v3 call to slug='user' using svcconfig, then map the resulting bag into ctx['bag'] for finalize().",
      dtoType,
    });

    this.log.warn(
      {
        event: "svcclient_stub",
        dtoType,
        requestId,
      },
      "auth.callUserCreate: SvcClient-backed call to User service is not implemented yet"
    );

    this.log.debug(
      { event: "execute_exit" },
      "auth.callUserCreate: exit handler (stub)"
    );
  }
}
