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

  protected handlerPurpose(): string {
    return "Extract a cleartext signup password from headers, validate its length, and stash it on the context without ever logging the secret.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "signup.extractPassword: enter handler"
    );

    try {
      const headers = this.safeCtxGet<Record<string, unknown>>("headers") ?? {};

      // Express lowercases header names in practice, but we defensively check both.
      const raw =
        (headers["x-nv-password"] as string | undefined) ??
        (headers["X-NV-PASSWORD"] as string | undefined);

      if (typeof raw !== "string") {
        this.failWithError({
          httpStatus: 400,
          title: "password_missing",
          detail:
            "Signup password header is missing. Dev: send the cleartext password in the 'x-nv-password' HTTP header for auth.signup.",
          stage: "extract.header",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              hasLowercaseHeader: Object.prototype.hasOwnProperty.call(
                headers,
                "x-nv-password"
              ),
              hasUppercaseHeader: Object.prototype.hasOwnProperty.call(
                headers,
                "X-NV-PASSWORD"
              ),
            },
          ],
          logMessage:
            "signup.extractPassword: x-nv-password header is missing or not a string.",
          logLevel: "warn",
        });
        return;
      }

      const password = raw.trim();

      const minLen = 8;
      const maxLen = 256;

      if (password.length < minLen || password.length > maxLen) {
        this.failWithError({
          httpStatus: 400,
          title: "password_invalid",
          detail:
            `Signup password does not meet length requirements (min ${minLen}, max ${maxLen}). ` +
            "Dev: enforce password policy on the client before calling auth.signup.",
          stage: "validate.length",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              length: password.length,
              minLen,
              maxLen,
            },
          ],
          logMessage:
            "signup.extractPassword: password length out of bounds (value not logged, length only).",
          logLevel: "warn",
        });
        return;
      }

      // Store only the cleartext in a dedicated ctx slot; NEVER log the value.
      // (Downstream handlers are responsible for hashing and then discarding it.)
      this.ctx.set("signup.passwordClear", password);
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "password_extracted",
          requestId,
          length: password.length,
        },
        "signup.extractPassword: password extracted and stored on ctx['signup.passwordClear']"
      );
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "extract_password_handler_failure",
        detail:
          "Unhandled exception while extracting the signup password. Ops: inspect logs for requestId and stack frame.",
        stage: "execute.unhandled",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        rawError: err,
        logMessage:
          "signup.extractPassword: unhandled exception in password extraction handler.",
        logLevel: "error",
      });
    }

    this.log.debug(
      {
        event: "execute_end",
        handler: this.constructor.name,
        requestId,
        handlerStatus: this.safeCtxGet<string>("handlerStatus") ?? "ok",
      },
      "signup.extractPassword: exit handler"
    );
  }
}
