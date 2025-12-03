// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/extractPassword.handler.ts
/**
 * Docs:
 * - SOP: DTO-only bodies; secrets never live in DTOs
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *
 * Purpose:
 * - Extract the signup password from HTTP headers, validate basic constraints,
 *   and stash it in ctx["signup.password"] without ever logging the raw value.
 *
 * Inputs (ctx):
 * - "headers": Record<string, unknown> (populated by ControllerBase.makeContext)
 *
 * Outputs (ctx on success):
 * - "signup.password": string   (NOT logged anywhere)
 * - "handlerStatus": "ok"
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

export class ExtractPasswordHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const requestId = this.ctx.get("requestId");

    const headers = this.ctx.get<Record<string, unknown>>("headers") ?? {};

    // Express lowercases header names.
    const raw =
      (headers["x-nv-password"] as string | undefined) ??
      (headers["X-NV-PASSWORD"] as string | undefined);

    if (typeof raw !== "string") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "PASSWORD_MISSING",
        title: "Bad Request",
        detail:
          "Signup password header is missing. Dev: send the cleartext password in the 'x-nv-password' HTTP header for auth.signup.",
        requestId,
      });

      this.log.warn(
        { event: "password_missing", requestId },
        "signup.extractPassword: x-nv-password header is missing"
      );
      return;
    }

    const password = raw.trim();

    const minLen = 8;
    const maxLen = 256;

    if (password.length < minLen || password.length > maxLen) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "PASSWORD_INVALID",
        title: "Bad Request",
        detail:
          `Signup password does not meet length requirements (min ${minLen}, max ${maxLen}). ` +
          "Dev: enforce password policy on the client before calling auth.signup.",
        requestId,
      });

      this.log.warn(
        {
          event: "password_invalid_length",
          requestId,
          length: password.length,
        },
        "signup.extractPassword: password length out of bounds"
      );
      return;
    }

    this.ctx.set("signup.password", password);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "password_extracted",
        requestId,
        length: password.length,
      },
      "signup.extractPassword: password extracted and stored on ctx['signup.password']"
    );
  }
}
