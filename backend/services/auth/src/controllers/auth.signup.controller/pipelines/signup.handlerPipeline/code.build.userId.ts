// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.build.userId.ts

/**
 * Docs:
 * - SOP: Explicit id generation; DTOs consume ids, they do not invent them.
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 *   - Build-a-test-guide (Handler-level test pattern: canonical test + scenarios)
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
 * - Test wiring:
 *     • hasTest() opt-in only.
 *     • runTest() bridges this handler to the canonical CodeBuildUserIdTest.
 *     • ScenarioRunner discovers scenarios via getScenarios() in
 *       code.build.userId.test.ts, using handlerName "code.build.userId".
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

// Centralized UUIDv4 generator (ADR-0057)
import { newUuid } from "@nv/shared/utils/uuid";

// Test harness types
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { CodeBuildUserIdTest } from "./code.build.userId.test";

export class CodeBuildUserIdHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  /**
   * Test opt-in:
   * - StepIterator / test-runner will see this true and invoke runTest().
   */
  public hasTest(): boolean {
    return true;
  }

  /**
   * Canonical test entrypoint:
   * - Bridges this handler to its primary smoke test.
   * - The test module also exposes getScenarios() for ScenarioRunner.
   */
  public override async runTest(): Promise<HandlerTestResult | undefined> {
    return this.runSingleTest(CodeBuildUserIdTest);
  }

  /**
   * Stable handler name for test discovery.
   *
   * Convention:
   * - HandlerTestDto.handlerName == "code.build.userId"
   * - Test module file == "code.build.userId.test.ts"
   */
  public getHandlerName(): string {
    return "code.build.userId";
  }

  protected handlerPurpose(): string {
    return "Generate or reuse a stable UUIDv4 for a signup pipeline without ever overwriting an existing id.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    try {
      const existing = this.safeCtxGet<string>("signup.userId");

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

      // Generate canonical UUIDv4 (ADR-0057)
      let generated: string;
      try {
        generated = newUuid();
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "uuid_generation_failed",
          detail:
            "Failed to generate a UUIDv4 for signup.userId. Ops: inspect shared utils or upstream entropy source.",
          stage: "uuid.newUuid",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "auth.signup.buildSignupUserId: newUuid() threw unexpectedly.",
          logLevel: "error",
        });
        return;
      }

      this.ctx.set("signup.userId", generated);

      this.log.debug(
        {
          event: "signup_user_id_generated",
          id: generated,
          requestId,
        },
        "auth.signup.buildSignupUserId: minted UUIDv4 via shared newUuid()"
      );

      this.ctx.set("handlerStatus", "ok");
    } catch (err) {
      // Unexpected handler bug
      this.failWithError({
        httpStatus: 500,
        title: "signup_user_id_handler_failure",
        detail:
          "Unhandled exception while minting signup.userId. Ops: inspect logs for requestId and stack frame.",
        stage: "execute.unhandled",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "auth.signup.buildSignupUserId: unhandled exception in handler.",
        logLevel: "error",
      });
    }
  }
}
