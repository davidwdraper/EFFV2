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
 *   1) Happy path: user.create succeeds; signup.userCreateStatus.ok === true.
 *   2) Sad path: malformed bag/envelope causes downstream failure and handler rails with error.
 *   3) Sad path: missing givenName/familyName/email causes downstream failure and handler rails with error.
 *
 * DTO discipline:
 * - Tests MUST NOT synthesize JSON payloads by hand for DTO-backed S2S calls.
 * - Instead:
 *   1) Mint a UserDto from the shared DTO registry.
 *   2) Set fields via the DTO’s setters.
 *   3) Use dto.toBody() as the only source of JSON for the bag.
 * - Test data must be unique (per test instance) to avoid dup collisions; use
 *   HandlerTestBase.suffix() to vary fields like email, name, etc.
 */

import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";

// TODO: Adjust this import to your real shared registry location / name.
import { UserDtoRegistry as userRegistry } from "@nv/shared/dto/registry/user.dtoRegistry";

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
 * Happy-path scenario.
 */
export class S2sUserCreate_HappyPath_Test extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.s2s.user.create.happy";
  }

  public testName(): string {
    return "auth.signup: S2sUserCreateHandler happy path — user.create succeeds";
  }

  /**
   * Mint a UserDto via the shared registry, set fields via setters, and build
   * a bag using dto.toBody(). Uses this.suffix() to keep data unique.
   */
  private makeUserBagFromDto(mutate?: (dto: UserDto) => void): UserBag {
    const dto = new userRegistry().newUserDto();
    const suffix = this.suffix();

    // Adjust these setter names to match your actual UserDto contract.
    dto.setGivenName?.(`AuthS2S${suffix}`);
    dto.setLastName?.(`UserCreate${suffix}`);
    dto.setEmail?.(`auth.s2s.user.create+${suffix}@example.com`);

    if (mutate) {
      mutate(dto);
    }

    const body = dto.toBody();

    const bagLike = {
      meta: {
        dtoType: "user",
      },
      items: [
        {
          id: (dto as any).getId ? (dto as any).getId() : undefined,
          data: body,
        },
      ],
    };

    return bagLike as unknown as UserBag;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-s2s-user-create-happy",
      dtoType: "user",
      op: "s2s.user.create",
    });

    const signupUserId = `auth-s2s-user-create-happy-user-id-${this.suffix()}`;
    ctx.set("signup.userId", signupUserId);

    const bag = this.makeUserBagFromDto();
    ctx.set("bag", bag);

    await this.runHandler({
      handlerCtor: S2sUserCreateHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    const rawResponseStatus = ctx.get<number>("response.status");
    const statusCode =
      rawResponseStatus !== undefined
        ? rawResponseStatus
        : ctx.get<number>("status");

    const status = ctx.get<UserCreateStatus>("signup.userCreateStatus");

    this.assertEq(
      String(handlerStatus ?? ""),
      "ok",
      "handlerStatus should be 'ok' on S2S user.create happy path"
    );

    this.assertEq(
      String(statusCode ?? ""),
      "200",
      "HTTP status should be 200 on S2S user.create happy path"
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
export class S2sUserCreate_BadEnvelope_Test extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.s2s.user.create.badEnvelope";
  }

  public testName(): string {
    return "auth.signup: S2sUserCreateHandler sad path — malformed envelope";
  }

  protected expectedError(): boolean {
    return true;
  }

  private makeValidUserBag(): UserBag {
    const dto: UserDto = new userRegistry().newUserDto();
    const suffix = this.suffix();

    dto.setGivenName?.(`AuthS2S-BadEnv-${suffix}`);
    dto.setLastName?.(`UserCreate-BadEnv-${suffix}`);
    dto.setEmail?.(`auth.s2s.user.create.badenv+${suffix}@example.com`);

    const body = dto.toBody();

    const bagLike = {
      meta: {
        dtoType: "user",
      },
      items: [
        {
          id: (dto as any).getId ? (dto as any).getId() : undefined,
          data: body,
        },
      ],
    };

    return bagLike as unknown as UserBag;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-s2s-user-create-bad-envelope",
      dtoType: "user",
      op: "s2s.user.create",
    });

    const signupUserId = `auth-s2s-user-create-bad-envelope-user-id-${this.suffix()}`;
    ctx.set("signup.userId", signupUserId);

    // Start from a valid DTO-backed bag and then corrupt the envelope shape.
    const goodBag = this.makeValidUserBag();
    const badEnvelope = {
      meta: (goodBag as any).meta,
      items: [
        {
          // Drop `data`, replace with an unexpected field to break shape.
          payload: (goodBag as any).items?.[0]?.data,
        },
      ],
    };

    ctx.set("bag", badEnvelope as unknown as UserBag);

    await this.runHandler({
      handlerCtor: S2sUserCreateHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    const rawResponseStatus = ctx.get<number>("response.status");
    const statusCode =
      rawResponseStatus !== undefined
        ? rawResponseStatus
        : ctx.get<number>("status");

    const status = ctx.get<UserCreateStatus>("signup.userCreateStatus");

    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' when envelope is malformed"
    );

    this.assert(
      statusCode !== 200,
      "HTTP status should not be 200 when envelope is malformed"
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
export class S2sUserCreate_MissingFields_Test extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.s2s.user.create.missingFields";
  }

  public testName(): string {
    return "auth.signup: S2sUserCreateHandler sad path — missing givenName/familyName/email";
  }

  protected expectedError(): boolean {
    return true;
  }

  private makeUserBagWithMissingFields(): UserBag {
    const dto: UserDto = new userRegistry().newUserDto();
    const suffix = this.suffix();

    // Seed with valid values first (to match normal flows)...
    dto.setGivenName?.(`AuthS2S-Missing-${suffix}`);
    dto.setLastName?.(`UserCreate-Missing-${suffix}`);
    dto.setEmail?.(`auth.s2s.user.create.missing+${suffix}@example.com`);

    // ...then clear the required fields via setters / allowed mutation.
    dto.setGivenName?.("");
    dto.setLastName?.("");
    dto.setEmail?.("");

    const body = dto.toBody();

    const bagLike = {
      meta: {
        dtoType: "user",
      },
      items: [
        {
          id: (dto as any).getId ? (dto as any).getId() : undefined,
          data: body,
        },
      ],
    };

    return bagLike as unknown as UserBag;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-s2s-user-create-missing-fields",
      dtoType: "user",
      op: "s2s.user.create",
    });

    const signupUserId = `auth-s2s-user-create-missing-fields-user-id-${this.suffix()}`;
    ctx.set("signup.userId", signupUserId);

    const bag = this.makeUserBagWithMissingFields();
    ctx.set("bag", bag);

    await this.runHandler({
      handlerCtor: S2sUserCreateHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    const rawResponseStatus = ctx.get<number>("response.status");
    const statusCode =
      rawResponseStatus !== undefined
        ? rawResponseStatus
        : ctx.get<number>("status");

    const status = ctx.get<UserCreateStatus>("signup.userCreateStatus");

    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' when required user fields are missing"
    );

    this.assert(
      statusCode !== 200,
      "HTTP status should not be 200 when required fields are missing"
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
        const test = new S2sUserCreate_HappyPath_Test();
        return await test.run();
      },
    },
    {
      id: "auth.signup.s2s.user.create.badEnvelope",
      name: "auth.signup: S2sUserCreateHandler rails on malformed user.create envelope",
      shortCircuitOnFail: false,
      expectedError: true,
      async run(): Promise<HandlerTestResult> {
        const test = new S2sUserCreate_BadEnvelope_Test();
        return await test.run();
      },
    },
    {
      id: "auth.signup.s2s.user.create.missingFields",
      name: "auth.signup: S2sUserCreateHandler rails when givenName/familyName/email are missing",
      shortCircuitOnFail: false,
      expectedError: true,
      async run(): Promise<HandlerTestResult> {
        const test = new S2sUserCreate_MissingFields_Test();
        return await test.run();
      },
    },
  ];
}

/**
 * Back-compat alias for any legacy imports.
 */
export { S2sUserCreate_BadEnvelope_Test as S2sUserCreate_MissingBag_Test };
