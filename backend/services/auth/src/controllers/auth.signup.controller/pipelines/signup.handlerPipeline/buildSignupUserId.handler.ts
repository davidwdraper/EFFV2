// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/buildSignupUserId.handler.ts
/**
 * Docs:
 * - SOP: Explicit id generation; DTOs consume ids, they do not invent them.
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 *
 * Purpose:
 * - Generate a stable UUIDv4 for this signup operation and store it on the
 *   HandlerContext as ctx["signup.userId"].
 * - This id becomes:
 *     • The canonical user id for UserDto (applied via setIdOnce() in the hydrator),
 *     • The foreign key for UserAuthDto.
 *
 * Invariants:
 * - Pure id minting: no DTO knowledge, no validation beyond UUIDv4 generation.
 * - Idempotent: if ctx["signup.userId"] is already set, do not overwrite it.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

// Centralized UUIDv4 generator (ADR-0057)
import { newUuid } from "@nv/shared/utils/uuid";

export class BuildSignupUserIdHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected override async execute(): Promise<void> {
    const requestId = this.ctx.get<string | undefined>("requestId");
    const existing = this.ctx.get<string | undefined>("signup.userId");

    // Idempotency: never overwrite an existing id
    if (existing && existing.trim().length > 0) {
      this.log.debug(
        {
          event: "signup_user_id_already_set",
          requestId,
        },
        "auth.signup.buildSignupUserId: ctx['signup.userId'] already populated; leaving as-is"
      );

      this.ctx.set("handlerStatus", "ok");
      return;
    }

    // Generate a canonical UUIDv4 via shared utils
    const generated = newUuid(); // ADR-0057: normalized, validated, centralized

    this.ctx.set("signup.userId", generated);

    this.log.debug(
      {
        event: "signup_user_id_generated",
        requestId,
      },
      "auth.signup.buildSignupUserId: minted UUIDv4 via shared newUuid()"
    );

    this.ctx.set("handlerStatus", "ok");
  }
}
