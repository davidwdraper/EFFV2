// backend/services/shared/src/http/handlers//code.mint.uuid.ts
/**
 * Docs:
 * - SOP: Explicit id generation; DTOs consume ids, they do not invent them.
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 * - Build-a-test-guide (Handler-level test pattern)
 *
 * Purpose:
 * - Mint a canonical UUIDv4 and store it as a step baton on the HandlerContext:
 *     ctx["step.uuid"]
 *
 * Baton semantics:
 * - This handler is shared LEGO and slug-agnostic.
 * - Pipelines that require a UUID MUST place this handler immediately
 *   before the consumer.
 * - Multiple mints per pipeline are allowed; overwrite is intentional.
 *
 * Invariants:
 * - Pure UUID minting: no DTO or domain knowledge.
 * - Always overwrites ctx["step.uuid"].
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import type { ControllerBase } from "../../base/controller/ControllerBase";

// Centralized UUIDv4 generator (ADR-0057)
import { newUuid } from "../../utils/uuid";

export class CodeMintUuidHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public getHandlerName(): string {
    return "code.mint.uuid";
  }

  protected handlerPurpose(): string {
    return "Mint a UUIDv4 baton on ctx['step.uuid'] for immediate next-step consumption.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    try {
      let generated: string;

      try {
        generated = newUuid();
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "uuid_generation_failed",
          detail:
            "Failed to mint UUIDv4 for ctx['step.uuid']. Ops: inspect shared uuid utility.",
          stage: "uuid.newUuid",
          requestId,
          rawError: err,
          origin: { file: __filename, method: "execute" },
          logMessage: "code.mint.uuid: newUuid() threw unexpectedly.",
          logLevel: "error",
        });
        return;
      }

      // Baton semantics: overwrite by design
      this.ctx.set("step.uuid", generated);

      this.log.debug(
        {
          event: "step_uuid_minted",
          id: generated,
          requestId,
        },
        "code.mint.uuid: minted UUIDv4 baton"
      );

      this.ctx.set("handlerStatus", "ok");
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "code_mint_uuid_handler_failure",
        detail:
          "Unhandled exception while minting ctx['step.uuid']. Ops: inspect logs.",
        stage: "execute.unhandled",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage: "code.mint.uuid: unhandled exception.",
        logLevel: "error",
      });
    }
  }
}
