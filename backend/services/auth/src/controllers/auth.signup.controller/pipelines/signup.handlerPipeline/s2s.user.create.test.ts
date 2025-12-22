// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.user.create.test.ts

/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - LDD-40 (Handler Test Design — Build-a-test-guide)
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0047 (DtoBag & Views)
 * - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 * - ADR-0057 (Shared SvcClient for S2S Calls)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Define handler-level tests for S2sUserCreateHandler.
 * - Scenarios:
 *   1) Canonical happy path: user.create succeeds; signup.userCreateStatus.ok === true.
 *   2) Sad path: malformed bag/envelope causes downstream failure and handler rails with error.
 *   3) Sad path: missing givenName/familyName/email causes downstream failure and handler rails with error.
 *
 * DTO discipline:
 * - Tests MUST NOT synthesize JSON payloads by hand for DTO-backed S2S calls.
 * - Instead:
 *   1) Mint a UserDto from the shared DTO registry.
 *   2) Set fields via the DTO’s setters.
 *   3) Apply a UUIDv4 id via setIdOnce().
 *   4) Use BagBuilder.fromDtos() to produce a real DtoBag<UserDto>.
 */

import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import { UserDtoRegistry as userRegistry } from "@nv/shared/dto/registry/user.dtoRegistry";
import { newUuid } from "@nv/shared/utils/uuid";

import { S2sUserCreateHandler } from "./s2s.user.create";

type UserBag = DtoBag<UserDto>;

interface UserCreateStatusOk {
  ok: true;
  userId?: string;
}

interface UserCreateStatusError {
  ok: false;
  code: string;
  message: string;
}

type UserCreateStatus = UserCreateStatusOk | UserCreateStatusError;

/**
 * Helper: build a real DtoBag<UserDto> for tests.
 * - Applies signupUserId via dto.setIdOnce() so bag shape matches the real pipeline.
 */
function buildUserBag(
  signupUserId: string,
  seed: (dto: UserDto, suffix: string) => void,
  requestId: string
): UserBag {
  const registry = new userRegistry();
  const dto = registry.newUserDto();
  const suffix = requestId; // just a stable-ish unique token for this test

  // Seed caller-provided fields
  seed(dto, suffix);

  // Apply canonical UUIDv4 id immediately, matching pipeline behavior
  dto.setIdOnce?.(signupUserId);

  const { bag } = BagBuilder.fromDtos([dto], {
    requestId,
    limit: 1,
    total: 1,
    cursor: null,
  });

  return bag as UserBag;
}

/**
 * Canonical happy-path scenario.
 * Used by S2sUserCreateHandler.runTest() via runSingleTest().
 */
export class S2sUserCreateTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.s2s.user.create.happy";
  }

  public testName(): string {
    return "auth.signup: S2sUserCreateHandler happy path — user.create succeeds";
  }

  protected expectedError(): boolean {
    return false;
  }

  protected async execute(): Promise<void> {
    const requestId = "req-auth-s2s-user-create-happy";
    const ctx = this.makeCtx({
      requestId,
      dtoType: "user",
      op: "s2s.user.create",
    });

    // Happy-path: signup.userId must be a real UUIDv4
    const signupUserId = newUuid();
    ctx.set("signup.userId", signupUserId);

    const bag = buildUserBag(
      signupUserId,
      (dto, suffix) => {
        dto.setGivenName?.(`AuthS2S${suffix}`);
        dto.setLastName?.(`UserCreate${suffix}`);
        dto.setEmail?.(`auth.s2s.user.create+${suffix}@example.com`);
      },
      requestId
    );

    ctx.set("bag", bag);

    await this.runHandler({
      handlerCtor: S2sUserCreateHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    const status = ctx.get<UserCreateStatus>("signup.userCreateStatus");

    this.assertEq(
      String(handlerStatus ?? ""),
      "ok",
      "handlerStatus should be 'ok' on S2S user.create happy path"
    );

    this.assert(
      !!status && status.ok === true,
      "signup.userCreateStatus.ok should be true on happy path"
    );

    if (status && status.ok === true) {
      this.assertEq(
        String(status.userId ?? ""),
        signupUserId,
        "signup.userCreateStatus.userId should mirror ctx['signup.userId']"
      );
    }
  }
}

/**
 * Sad path — malformed envelope.
 */
export class S2sUserCreateBadEnvelopeTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.s2s.user.create.badEnvelope";
  }

  public testName(): string {
    return "auth.signup: S2sUserCreateHandler sad path — malformed envelope";
  }

  protected expectedError(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    const requestId = "req-auth-s2s-user-create-bad-envelope";
    const ctx = this.makeCtx({
      requestId,
      dtoType: "user",
      op: "s2s.user.create",
    });

    const signupUserId = newUuid();
    ctx.set("signup.userId", signupUserId);

    // Start from a valid DtoBag<UserDto> and then corrupt the envelope shape.
    const goodBag = buildUserBag(
      signupUserId,
      (dto, suffix) => {
        dto.setGivenName?.(`AuthS2S-BadEnv-${suffix}`);
        dto.setLastName?.(`UserCreate-BadEnv-${suffix}`);
        dto.setEmail?.(`auth.s2s.user.create.badenv+${suffix}@example.com`);
      },
      requestId
    );

    // Corrupt the envelope: replace items[] with wrong shape.
    const itemsArray =
      typeof (goodBag as any).items === "function"
        ? Array.from((goodBag as any).items())
        : [];

    const firstItem = itemsArray[0] ?? {};

    const badEnvelope = {
      meta: (goodBag as any).meta,
      items: [
        {
          // Drop the expected DtoBag item structure; inject a bogus payload.
          payload: (firstItem as any).data ?? firstItem,
        },
      ],
    };

    ctx.set("bag", badEnvelope as unknown as UserBag);

    await this.runHandler({
      handlerCtor: S2sUserCreateHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    const status = ctx.get<UserCreateStatus>("signup.userCreateStatus");

    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' when envelope is malformed"
    );

    this.assert(
      !!status && status.ok === false,
      "signup.userCreateStatus.ok should be false when envelope is malformed"
    );

    if (status && status.ok === false) {
      this.assert(
        status.code === "AUTH_SIGNUP_USER_CREATE_FAILED" ||
          status.code === "AUTH_SIGNUP_USER_DUPLICATE",
        "signup.userCreateStatus.code should indicate a user.create failure/duplicate"
      );
      this.assert(
        typeof status.message === "string" && status.message.length > 0,
        "signup.userCreateStatus.message should contain an error message"
      );
    }
  }
}

/**
 * Sad path — missing required fields (givenName, familyName, email).
 */
export class S2sUserCreateMissingFieldsTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.s2s.user.create.missingFields";
  }

  public testName(): string {
    return "auth.signup: S2sUserCreateHandler sad path — missing givenName/familyName/email";
  }

  protected expectedError(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    const requestId = "req-auth-s2s-user-create-missing-fields";
    const ctx = this.makeCtx({
      requestId,
      dtoType: "user",
      op: "s2s.user.create",
    });

    const signupUserId = newUuid();
    ctx.set("signup.userId", signupUserId);

    const bag = buildUserBag(
      signupUserId,
      (dto, suffix) => {
        // Seed with valid values first...
        dto.setGivenName?.(`AuthS2S-Missing-${suffix}`);
        dto.setLastName?.(`UserCreate-Missing-${suffix}`);
        dto.setEmail?.(`auth.s2s.user.create.missing+${suffix}@example.com`);

        // ...then clear the required fields via setters / allowed mutation.
        dto.setGivenName?.("");
        dto.setLastName?.("");
        dto.setEmail?.("");
      },
      requestId
    );

    ctx.set("bag", bag);

    await this.runHandler({
      handlerCtor: S2sUserCreateHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    const status = ctx.get<UserCreateStatus>("signup.userCreateStatus");

    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' when required user fields are missing"
    );

    this.assert(
      !!status && status.ok === false,
      "signup.userCreateStatus.ok should be false when required fields are missing"
    );

    if (status && status.ok === false) {
      this.assert(
        typeof status.code === "string" && status.code.length > 0,
        "signup.userCreateStatus.code should be populated on missing-field failure"
      );
      this.assert(
        typeof status.message === "string" && status.message.length > 0,
        "signup.userCreateStatus.message should be populated on missing-field failure"
      );
    }
  }
}

/**
 * New-style contract for the test-runner: expose scenarios via getScenarios().
 */
export async function getScenarios() {
  return [
    {
      id: "auth.signup.s2s.user.create.happy",
      name: "auth.signup: S2sUserCreateHandler happy path (user.create succeeds)",
      shortCircuitOnFail: true,
      expectedError: false,
      async run(): Promise<HandlerTestResult> {
        const test = new S2sUserCreateTest();
        return await test.run();
      },
    },
    {
      id: "auth.signup.s2s.user.create.badEnvelope",
      name: "auth.signup: S2sUserCreateHandler rails on malformed user.create envelope",
      shortCircuitOnFail: false,
      expectedError: true,
      async run(): Promise<HandlerTestResult> {
        const test = new S2sUserCreateBadEnvelopeTest();
        return await test.run();
      },
    },
    {
      id: "auth.signup.s2s.user.create.missingFields",
      name: "auth.signup: S2sUserCreateHandler rails when givenName/familyName/email are missing",
      shortCircuitOnFail: false,
      expectedError: true,
      async run(): Promise<HandlerTestResult> {
        const test = new S2sUserCreateMissingFieldsTest();
        return await test.run();
      },
    },
  ];
}
