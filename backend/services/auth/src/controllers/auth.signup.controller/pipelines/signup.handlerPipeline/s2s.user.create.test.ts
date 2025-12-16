// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.user.create.test.ts
/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - LDD-36 (Handler Test SOP — per-handler patterns)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Handler-level tests for S2sUserCreateHandler.
 * - Scenario 1: Happy path with valid ctx["bag"] and signup.userId; calls REAL SvcClient via runner-supplied AppBase.
 * - Scenario 2: Sad path for missing ctx["bag"] guard; MUST NOT call SvcClient.
 *
 * Invariant (KISS):
 * - Tests do NOT care about DB_MOCKS / S2S_MOCKS.
 * - Tests do NOT stub SvcClient.
 * - Rails decide; SvcClient enforces; HandlerTestBase enforces rails verdict.
 */

import { DtoBag } from "@nv/shared/dto/DtoBag";
import { UserDto } from "@nv/shared/dto/user.dto";
import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";

import { S2sUserCreateHandler } from "./s2s.user.create";

/**
 * Scenario 1 — Happy Path
 */
export class S2sUserCreate_HappyPath_Test extends HandlerTestBase {
  public testId(): string {
    return "auth.s2s.user.create:happy-path";
  }

  public testName(): string {
    return "auth s2s.user.create calls user.create and stamps signup.userCreateStatus on success";
  }

  protected async execute(): Promise<void> {
    // 1) fresh ctx + defaults (KISS)
    const ctx = this.makeCtx({
      requestId: "req-test-123",
      dtoType: "user",
      op: "create",
    });

    // 2) scenario deltas
    const userDto = UserDto.fromBody(
      { givenName: "Test", lastName: "User", email: "test@example.com" },
      { validate: true }
    );

    const bag = new DtoBag<UserDto>([userDto]);
    ctx.set("bag", bag);
    ctx.set("signup.userId", "test-user-id-123");

    // 3) run handler under rails (REAL controller harness; REAL SvcClient via runner-supplied AppBase)
    await this.runHandler({
      handlerCtor: S2sUserCreateHandler,
      ctx,
    });

    // 4) assertions (svc-level correctness, not transport spying)
    const handlerStatus = ctx.get<string | undefined>("handlerStatus");
    this.assert(
      !handlerStatus || handlerStatus === "ok",
      `Expected handlerStatus to be ok/undefined, got "${handlerStatus}".`
    );

    const status = ctx.get<{
      ok: boolean;
      userId?: string;
      code?: string;
      message?: string;
    }>("signup.userCreateStatus");

    this.assertDefined(status, "Expected signup.userCreateStatus to be set.");
    this.assertTrue(
      status.ok === true,
      `Expected signup.userCreateStatus.ok === true, got ${JSON.stringify(
        status
      )}.`
    );

    this.assertEq(
      status.userId,
      "test-user-id-123",
      "signup.userCreateStatus.userId"
    );

    // Handler should not replace the bag on success.
    const bagAfter = ctx.get<DtoBag<UserDto>>("bag");
    this.assert(
      bagAfter === bag,
      "Expected ctx['bag'] to be the same DtoBag instance after S2sUserCreateHandler."
    );
  }
}

/**
 * Scenario 2 — Sad Path: Missing ctx["bag"]
 *
 * IMPORTANT:
 * - This is a negative test. It MUST be marked expectedError=true so rails can
 *   downgrade logs and so the test-runner can treat it as intentionally negative.
 */
export class S2sUserCreate_MissingBag_Test extends HandlerTestBase {
  public testId(): string {
    return "auth.s2s.user.create:missing-bag";
  }

  public testName(): string {
    return "auth s2s.user.create fails with missing ctx['bag'] and sets signup.userCreateStatus.ok=false";
  }

  protected override expectedError(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    // 1) fresh ctx + defaults
    const ctx = this.makeCtx({
      requestId: "req-test-missing-bag",
      dtoType: "user",
      op: "create",
    });

    // 2) scenario deltas (intentionally do NOT set ctx["bag"])
    // (nothing else)

    // 3) run handler under rails (must error)
    await this.runHandler({
      handlerCtor: S2sUserCreateHandler,
      ctx,
    });

    // 4) assertions
    const handlerStatus = ctx.get<string | undefined>("handlerStatus");
    this.assertEq(handlerStatus, "error", "handlerStatus");

    const status = ctx.get<{
      ok: boolean;
      code?: string;
      message?: string;
    }>("signup.userCreateStatus");

    this.assertDefined(status, "Expected signup.userCreateStatus to be set.");
    this.assertFalse(
      status.ok,
      `Expected signup.userCreateStatus.ok === false, got ${JSON.stringify(
        status
      )}.`
    );

    this.assertEq(
      status.code,
      "AUTH_SIGNUP_MISSING_USER_BAG",
      "signup.userCreateStatus.code"
    );
  }
}
