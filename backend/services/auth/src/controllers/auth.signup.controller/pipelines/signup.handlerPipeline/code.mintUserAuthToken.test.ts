// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.mintUserAuthToken.test.ts
/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - LDD-40 (Handler Test Design — Build-a-test-guide)
 * - ADR-0035 (JWKS Service for Public Keys)
 * - ADR-0036 (Token Minter using GCP KMS Sign)
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0044 (EnvServiceDto — Key/Value Contract)
 * - ADR-0057 (Shared SvcClient for S2S Calls)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0071 (Auth Signup JWT Placement — ctx["jwt.userAuth"])
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 *
 * Purpose:
 * - Runner-shaped handler tests for CodeMintUserAuthTokenHandler (ADR-0094 shape).
 * - Scenarios execute via deps.step.execute(ctx) so scenario ctx inherits
 *   pipeline runtime ("rt") automatically.
 *
 * Notes:
 * - This handler caches a module-level MintProvider singleton.
 *   That makes "corrupt env var after success" non-deterministic within the
 *   same process, so we do NOT include an env-corruption scenario here.
 *
 * Hard rules:
 * - No ALS / adaptive logging patterns.
 * - No semantics via ctx flags; expectations live in TestScenarioStatus only.
 * - Never log raw JWT values.
 */

import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";

type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

function readHttpStatus(ctx: any): number {
  const v = ctx.get("response.status") ?? ctx.get("status") ?? 200;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 200;
}

function readHandlerStatus(ctx: any): string {
  const v = ctx.get("handlerStatus");
  return typeof v === "string" ? v : "ok";
}

// ───────────────────────────────────────────
// ADR-0094 scenario runner helper
// ───────────────────────────────────────────
async function runScenario(input: {
  deps: any;

  testId: string;
  name: string;

  expectedMode: "success" | "failure";
  expectedHttpStatus?: number;

  seedCtx: (ctx: any, status: TestScenarioStatus) => void;
  assertAfter: (ctx: any, status: TestScenarioStatus) => void;
}): Promise<TestScenarioStatus> {
  const status = createTestScenarioStatus({
    scenarioId: input.testId,
    scenarioName: input.name,
    expected: input.expectedMode,
  });

  let ctx: any | undefined;

  try {
    try {
      ctx = input.deps.makeScenarioCtx({
        requestId: `req-${input.testId}`,
        dtoType: "user",
        op: "code.mintUserAuthToken",
      });

      input.seedCtx(ctx, status);

      await input.deps.step.execute(ctx);

      // Legitimacy lock: if the scenario pins a status code, enforce it here.
      if (typeof input.expectedHttpStatus === "number") {
        const httpStatus = readHttpStatus(ctx);
        if (httpStatus !== input.expectedHttpStatus) {
          status.recordAssertionFailure(
            `Expected httpStatus=${
              input.expectedHttpStatus
            } but got httpStatus=${httpStatus} (handlerStatus=${readHandlerStatus(
              ctx
            )}).`
          );
        }
      }

      input.assertAfter(ctx, status);
    } catch (err: any) {
      status.recordInnerCatch(err);
    } finally {
      TestScenarioFinalizer.finalize({ status, ctx });
    }
  } catch (err: any) {
    status.recordOuterCatch(err);
  } finally {
    TestScenarioFinalizer.finalize({ status, ctx });
  }

  return status;
}

// ───────────────────────────────────────────
// Assertions (record failures; do not throw)
// ───────────────────────────────────────────

function assertJwtMinted(ctx: any, status: TestScenarioStatus): void {
  const jwt = ctx.get("jwt.userAuth");
  const signupJwt = ctx.get("signup.jwt");

  if (!(typeof jwt === "string" && jwt.length > 0)) {
    status.recordAssertionFailure(
      "ctx['jwt.userAuth'] must be a non-empty string on success."
    );
    return;
  }

  if (signupJwt !== jwt) {
    status.recordAssertionFailure(
      "ctx['signup.jwt'] must match ctx['jwt.userAuth']."
    );
  }

  const headerUnknown = ctx.get("signup.jwtHeader") as unknown;
  if (!(headerUnknown && typeof headerUnknown === "object")) {
    status.recordAssertionFailure(
      "ctx['signup.jwtHeader'] must be an object on success."
    );
    return;
  }

  const header = headerUnknown as { alg?: unknown; kid?: unknown };

  if (!(typeof header.alg === "string" && header.alg.length > 0)) {
    status.recordAssertionFailure("jwtHeader.alg must be a non-empty string.");
  }

  if (!(typeof header.kid === "string" && header.kid.length > 0)) {
    status.recordAssertionFailure("jwtHeader.kid must be a non-empty string.");
  }

  const issuedAtUnknown = ctx.get("signup.jwtIssuedAt") as unknown;
  const expiresAtUnknown = ctx.get("signup.jwtExpiresAt") as unknown;

  if (
    !(typeof issuedAtUnknown === "number" && Number.isFinite(issuedAtUnknown))
  ) {
    status.recordAssertionFailure(
      "ctx['signup.jwtIssuedAt'] must be a finite number."
    );
    return;
  }

  if (
    !(typeof expiresAtUnknown === "number" && Number.isFinite(expiresAtUnknown))
  ) {
    status.recordAssertionFailure(
      "ctx['signup.jwtExpiresAt'] must be a finite number."
    );
    return;
  }

  const issuedAt = issuedAtUnknown as number;
  const expiresAt = expiresAtUnknown as number;

  if (!(expiresAt > issuedAt)) {
    status.recordAssertionFailure("jwtExpiresAt must be > jwtIssuedAt.");
  }
}

function assertJwtNotMinted(ctx: any, status: TestScenarioStatus): void {
  const jwt = ctx.get("jwt.userAuth");
  const signupJwt = ctx.get("signup.jwt");

  if (!!jwt) {
    status.recordAssertionFailure(
      "ctx['jwt.userAuth'] must not be set when mint does not run or fails."
    );
  }

  if (!!signupJwt) {
    status.recordAssertionFailure(
      "ctx['signup.jwt'] must not be set when mint does not run or fails."
    );
  }
}

// ───────────────────────────────────────────
// ScenarioRunner entrypoint
// ───────────────────────────────────────────
export async function getScenarios(deps: any): Promise<any[]> {
  return [
    {
      id: "auth.signup.mintUserAuthToken.happy",
      name: "auth.signup: mintUserAuthToken mints a JWT (real env-service config)",
      shortCircuitOnFail: true,

      async run(): Promise<TestScenarioStatus> {
        const requestId = "req-auth-mint-user-auth-token-happy";
        const userId = "mint-user-happy";

        return runScenario({
          deps,
          testId: "auth.signup.mintUserAuthToken.happy",
          name: "auth.signup: mintUserAuthToken mints a JWT (real env-service config)",
          expectedMode: "success",
          expectedHttpStatus: 200,

          seedCtx: (ctx) => {
            ctx.set("requestId", requestId);

            ctx.set("signup.userId", userId);
            ctx.set("signup.userCreateStatus", {
              ok: true,
              userId,
            } as UserCreateStatus);
            ctx.set("signup.userAuthCreateStatus", {
              ok: true,
            } as UserAuthCreateStatus);
          },

          assertAfter: (ctx, status) => {
            const hs = readHandlerStatus(ctx);
            if (hs !== "ok") {
              status.recordAssertionFailure(
                `Expected handlerStatus="ok" but got "${hs}".`
              );
            }

            // No raw JWT logging — just validate structure/presence.
            assertJwtMinted(ctx, status);
          },
        });
      },
    },

    {
      id: "auth.signup.mintUserAuthToken.missing-input",
      name: "auth.signup: mintUserAuthToken fails when signup.userId missing",
      shortCircuitOnFail: true,

      async run(): Promise<TestScenarioStatus> {
        const requestId = "req-auth-mint-user-auth-token-missing-input";

        return runScenario({
          deps,
          testId: "auth.signup.mintUserAuthToken.missing-input",
          name: "auth.signup: mintUserAuthToken fails when signup.userId missing",
          expectedMode: "failure",
          expectedHttpStatus: 500,

          seedCtx: (ctx) => {
            ctx.set("requestId", requestId);

            // Intentionally omit signup.userId
            ctx.set("signup.userCreateStatus", {
              ok: true,
            } as UserCreateStatus);
            ctx.set("signup.userAuthCreateStatus", {
              ok: true,
            } as UserAuthCreateStatus);
          },

          assertAfter: (ctx, status) => {
            const hs = readHandlerStatus(ctx);
            if (hs !== "error") {
              status.recordAssertionFailure(
                `Expected handlerStatus="error" but got "${hs}".`
              );
            }

            assertJwtNotMinted(ctx, status);
          },
        });
      },
    },
  ];
}
