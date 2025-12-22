// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.mintUserAuthToken.test.ts
/**
 * Docs:
 * - Build-a-test-guide.md (handler-level tests; ScenarioRunner pattern)
 * - ADR-0035 (JWKS Service for Public Keys)
 * - ADR-0036 (Token Minter using GCP KMS Sign)
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0044 (EnvServiceDto — Key/Value Contract)
 * - ADR-0057 (Shared SvcClient for S2S Calls)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0071 (Auth Signup JWT Placement — ctx["jwt.userAuth"])
 *
 * Purpose:
 * - Exercise CodeMintUserAuthTokenHandler under full rails using REAL env-service
 *   configuration for all scenarios.
 * - Sad-path scenarios mutate a single env var via a TTL-backed override helper
 *   so that tests do not poison long-lived config.
 */

import { CodeMintUserAuthTokenHandler } from "./code.mintUserAuthToken";
import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { overrideEnvVarWithTTL } from "@nv/shared/testing/envVarOverride";

type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * Locate the EnvServiceDto instance from the HandlerContext.
 *
 * Notes:
 * - This helper is test-only glue; it tolerates multiple app wiring styles
 *   (app.envDto vs app.getEnvDto()) and fails loudly if it cannot find one.
 */
function getEnvDtoFromCtx(ctx: any): EnvServiceDto {
  const appAny =
    typeof ctx.get === "function" && ctx.get("app")
      ? ctx.get("app")
      : (ctx as any).app ??
        (typeof (ctx as any).getApp === "function"
          ? (ctx as any).getApp()
          : undefined);

  if (!appAny) {
    throw new Error(
      "Test harness: could not locate app on HandlerContext (expected ctx.get('app'), ctx.app, or ctx.getApp())."
    );
  }

  if (typeof appAny.getEnvDto === "function") {
    return appAny.getEnvDto() as EnvServiceDto;
  }

  if (appAny.envDto) {
    return appAny.envDto as EnvServiceDto;
  }

  throw new Error(
    "Test harness: app does not expose EnvServiceDto (expected app.getEnvDto() or app.envDto)."
  );
}

/**
 * Scenario 1: Happy path — real KMS; token is minted and asserted.
 *
 * Invariants:
 * - Uses REAL env-service configuration (no test-time env injection).
 * - Asserts:
 *   • handlerStatus !== "error"
 *   • HTTP status is 200 (if present)
 *   • jwt.userAuth, signup.jwt, header, issuedAt, expiresAt are all present and sane.
 */
export class MintUserAuthTokenHappyScenario extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.mintUserAuthToken.happy";
  }

  public testName(): string {
    return "auth.signup: mintUserAuthToken mints a JWT via real KMS";
  }

  protected expectedError(): boolean {
    return false;
  }

  protected override async execute(): Promise<void> {
    const ctx = this.makeCtx();

    const userId = "mint-user-happy";

    ctx.set("signup.userId", userId);
    ctx.set("signup.userCreateStatus", {
      ok: true,
      userId,
    } satisfies UserCreateStatus);
    ctx.set("signup.userAuthCreateStatus", {
      ok: true,
    } satisfies UserAuthCreateStatus);

    // No env seeding here: handler must use whatever env-service provides.

    await this.runHandler({
      handlerCtor: CodeMintUserAuthTokenHandler,
      ctx,
    });

    const handlerStatus = ctx.get("handlerStatus") as unknown;
    const httpStatus = (ctx.get("response.status") ??
      ctx.get("status") ??
      null) as unknown;

    this.assertTrue(
      handlerStatus !== "error",
      "handlerStatus must not be 'error' when mint succeeds"
    );

    if (httpStatus !== null) {
      this.assertEq(
        httpStatus as number,
        200,
        "HTTP status should be 200 when mint succeeds"
      );
    }

    const jwt = ctx.get("jwt.userAuth") as unknown;
    const signupJwt = ctx.get("signup.jwt") as unknown;

    this.assertTrue(
      typeof jwt === "string" && jwt.length > 0,
      "ctx['jwt.userAuth'] must be a non-empty string on success"
    );
    this.assertEq(
      signupJwt,
      jwt,
      "ctx['signup.jwt'] must match ctx['jwt.userAuth'] (canonical placement of same token)"
    );

    const headerUnknown = ctx.get("signup.jwtHeader") as unknown;
    this.assertTrue(
      headerUnknown && typeof headerUnknown === "object",
      "ctx['signup.jwtHeader'] must be an object on success"
    );
    const header = headerUnknown as { alg?: unknown; kid?: unknown };

    this.assertTrue(
      typeof header.alg === "string" && header.alg.length > 0,
      "jwtHeader.alg must be a non-empty string"
    );
    this.assertTrue(
      typeof header.kid === "string" && header.kid.length > 0,
      "jwtHeader.kid must be a non-empty string"
    );

    const issuedAtUnknown = ctx.get("signup.jwtIssuedAt") as unknown;
    const expiresAtUnknown = ctx.get("signup.jwtExpiresAt") as unknown;

    this.assertTrue(
      typeof issuedAtUnknown === "number" && Number.isFinite(issuedAtUnknown),
      "ctx['signup.jwtIssuedAt'] must be a finite number"
    );
    this.assertTrue(
      typeof expiresAtUnknown === "number" && Number.isFinite(expiresAtUnknown),
      "ctx['signup.jwtExpiresAt'] must be a finite number"
    );

    const issuedAt = issuedAtUnknown as number;
    const expiresAt = expiresAtUnknown as number;

    this.assertTrue(
      expiresAt > issuedAt,
      "jwtExpiresAt must be greater than jwtIssuedAt"
    );
  }
}

/**
 * Scenario 2: Crap KMS data — upstream ok, but corrupt env var causes real KMS to fail.
 *
 * Mechanics:
 * - Uses REAL env-service config for all env values.
 * - Temporarily corrupts KMS_PROJECT_ID via overrideEnvVarWithTTL, then restores it.
 * - Asserts:
 *   • handlerStatus === "error"
 *   • HTTP status === 500
 *   • No JWT fields are set.
 */
export class MintUserAuthTokenCrapKmsScenario extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.mintUserAuthToken.crap-kms";
  }

  public testName(): string {
    return "auth.signup: mintUserAuthToken fails when KMS_PROJECT_ID is corrupted";
  }

  protected expectedError(): boolean {
    return true;
  }

  protected override async execute(): Promise<void> {
    const ctx = this.makeCtx();

    const userId = "mint-user-kms-error";

    ctx.set("signup.userId", userId);
    ctx.set("signup.userCreateStatus", {
      ok: true,
      userId,
    } satisfies UserCreateStatus);
    ctx.set("signup.userAuthCreateStatus", {
      ok: true,
    } satisfies UserAuthCreateStatus);

    // Locate the live EnvServiceDto and temporarily corrupt KMS_PROJECT_ID.
    const envDto = getEnvDtoFromCtx(ctx);

    const restore = overrideEnvVarWithTTL(
      envDto,
      "KMS_PROJECT_ID",
      (original) => original + "xxx",
      2000 // long enough for slow first KMS call; manual restore is primary
    );

    try {
      await this.runHandler({
        handlerCtor: CodeMintUserAuthTokenHandler,
        ctx,
      });
    } finally {
      // Primary safety: explicit restore as soon as handler completes.
      restore();
    }

    const handlerStatus = ctx.get("handlerStatus") as unknown;
    const httpStatus = (ctx.get("response.status") ??
      ctx.get("status") ??
      null) as unknown;

    this.assertEq(
      handlerStatus,
      "error",
      "handlerStatus must be 'error' when KMS signing fails"
    );

    this.assertEq(
      httpStatus as number,
      500,
      "HTTP status must be 500 when mint provider fails"
    );

    this.assertFalse(
      !!ctx.get("jwt.userAuth"),
      "ctx['jwt.userAuth'] must not be set when mint fails"
    );
    this.assertFalse(
      !!ctx.get("signup.jwt"),
      "ctx['signup.jwt'] must not be set when mint fails"
    );
  }
}

/**
 * Scenario 3: Missing userId — upstream ok but missing input → precondition failure.
 *
 * Mechanics:
 * - Uses REAL env-service config (no env mutations).
 * - Omits ctx['signup.userId'] entirely while upstream statuses say ok.
 * - Asserts:
 *   • handlerStatus === "error"
 *   • HTTP status === 500
 *   • No JWT fields are set.
 */
export class MintUserAuthTokenMissingInputScenario extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.mintUserAuthToken.missing-input";
  }

  public testName(): string {
    return "auth.signup: mintUserAuthToken fails when signup.userId missing";
  }

  protected expectedError(): boolean {
    return true;
  }

  protected override async execute(): Promise<void> {
    const ctx = this.makeCtx();

    ctx.set("signup.userCreateStatus", { ok: true } satisfies UserCreateStatus);
    ctx.set("signup.userAuthCreateStatus", {
      ok: true,
    } satisfies UserAuthCreateStatus);

    // Note: we intentionally do NOT set ctx['signup.userId'].

    await this.runHandler({
      handlerCtor: CodeMintUserAuthTokenHandler,
      ctx,
    });

    const handlerStatus = ctx.get("handlerStatus") as unknown;
    const httpStatus = (ctx.get("response.status") ??
      ctx.get("status") ??
      null) as unknown;

    this.assertEq(
      handlerStatus,
      "error",
      "handlerStatus must be 'error' when signup.userId is missing"
    );
    this.assertEq(
      httpStatus as number,
      500,
      "HTTP status must be 500 when signup.userId is missing"
    );

    this.assertFalse(
      !!ctx.get("jwt.userAuth"),
      "ctx['jwt.userAuth'] must not be set when signup.userId is missing"
    );
    this.assertFalse(
      !!ctx.get("signup.jwt"),
      "ctx['signup.jwt'] must not be set when signup.userId is missing"
    );
  }
}

/**
 * Scenario registry for ScenarioRunner
 */
export async function getScenarios() {
  return [
    {
      id: "auth.signup.mintUserAuthToken.happy",
      name: "auth.signup: mintUserAuthToken mints a JWT via real KMS",
      shortCircuitOnFail: true,
      expectedError: false,
      async run() {
        const t = new MintUserAuthTokenHappyScenario();
        return await t.run();
      },
    },
    {
      id: "auth.signup.mintUserAuthToken.crap-kms",
      name: "auth.signup: mintUserAuthToken fails when KMS_PROJECT_ID is corrupted",
      shortCircuitOnFail: true,
      expectedError: true,
      async run() {
        const t = new MintUserAuthTokenCrapKmsScenario();
        return await t.run();
      },
    },
    {
      id: "auth.signup.mintUserAuthToken.missing-input",
      name: "auth.signup: mintUserAuthToken fails when signup.userId missing",
      shortCircuitOnFail: true,
      expectedError: true,
      async run() {
        const t = new MintUserAuthTokenMissingInputScenario();
        return await t.run();
      },
    },
  ];
}
