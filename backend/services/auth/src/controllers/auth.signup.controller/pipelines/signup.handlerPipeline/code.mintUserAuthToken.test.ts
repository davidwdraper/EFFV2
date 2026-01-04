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
 * - ADR-0095 (Happy-Path-Only testing)
 *
 * Purpose:
 * - Happy-path handler test for CodeMintUserAuthTokenHandler (ADR-0094 shape).
 * - Scenario executes via deps.step.execute(ctx) so scenario ctx inherits
 *   pipeline runtime ("rt") automatically.
 *
 * Notes:
 * - This handler caches a module-level MintProvider singleton.
 *   That makes "corrupt env var after success" non-deterministic within the
 *   same process, so we do NOT include any env-corruption scenario here.
 *
 * Hard rules:
 * - No ALS / adaptive logging patterns.
 * - No semantics via ctx flags; expectations live in TestScenarioStatus only.
 * - Never log raw JWT values.
 *
 * ADR-0095:
 * - Exactly one scenario: HappyPath
 *
 * ADR-0094:
 * - Inner try/catch wraps ONLY handler execution.
 * - Outer try/catch protects runner integrity.
 * - Finalization is deterministic via TestScenarioFinalizer (run exactly once).
 */

import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";

type ScenarioDepsLike = {
  step: { execute: (scenarioCtx: any) => Promise<void> };
  makeScenarioCtx: (seed: {
    requestId: string;
    dtoType?: string;
    op?: string;
  }) => any;
};

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

export async function getScenarios(deps: ScenarioDepsLike): Promise<any[]> {
  return [
    {
      id: "HappyPath",
      name: "auth.signup: mintUserAuthToken mints a JWT (real env-service config)",
      shortCircuitOnFail: true,

      async run(localDeps: ScenarioDepsLike): Promise<TestScenarioStatus> {
        const requestId = "req-auth-mint-user-auth-token-happy";
        const userId = "mint-user-happy";

        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "auth.signup: mintUserAuthToken mints a JWT (real env-service config)",
          expected: "success",
        });

        let ctx: any | undefined;

        // Outer try/catch protects runner integrity (ADR-0094).
        try {
          ctx = localDeps.makeScenarioCtx({
            requestId,
            dtoType: "user",
            op: "code.mintUserAuthToken",
          });

          ctx.set("requestId", requestId);

          ctx.set("signup.userId", userId);
          ctx.set("signup.userCreateStatus", {
            ok: true,
            userId,
          } as UserCreateStatus);
          ctx.set("signup.userAuthCreateStatus", {
            ok: true,
          } as UserAuthCreateStatus);

          // Inner try/catch wraps ONLY handler execution (ADR-0094).
          try {
            await localDeps.step.execute(ctx);

            // Assertions MUST NOT throw (ADR-0094).
            const hs = readHandlerStatus(ctx);
            if (hs !== "ok") {
              status.recordAssertionFailure(
                `Expected handlerStatus="ok" but got "${hs}".`
              );
            }

            const httpStatus = readHttpStatus(ctx);
            if (httpStatus !== 200) {
              status.recordAssertionFailure(
                `Expected httpStatus=200 but got httpStatus=${httpStatus}.`
              );
            }

            // No raw JWT logging — just validate structure/presence.
            assertJwtMinted(ctx, status);
          } catch (err: any) {
            status.recordInnerCatch(err);
          }
        } catch (err: any) {
          status.recordOuterCatch(err);
        } finally {
          // Deterministic finalization exactly once (no double-finalize noise).
          TestScenarioFinalizer.finalize({ status, ctx });
        }

        return status;
      },
    },
  ];
}
