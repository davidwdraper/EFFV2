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
 *
 * Purpose:
 * - Runner-shaped handler tests for CodeMintUserAuthTokenHandler.
 * - Scenarios execute via deps.step.execute(ctx) so scenario ctx inherits
 *   pipeline runtime ("rt") automatically.
 *
 * Notes:
 * - This handler caches a module-level MintProvider singleton.
 *   That makes "corrupt env var after success" non-deterministic within the
 *   same process, so we do NOT include an env-corruption scenario here.
 */

type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

type Assert = { count: number; failed: string[] };

function assertEq(a: Assert, actual: any, expected: any, msg: string): void {
  a.count += 1;
  if (actual !== expected) {
    a.failed.push(`${msg} expected=${String(expected)} got=${String(actual)}`);
  }
}

function assertOk(a: Assert, cond: any, msg: string): void {
  a.count += 1;
  if (!cond) a.failed.push(msg);
}

function assertFalse(a: Assert, cond: any, msg: string): void {
  a.count += 1;
  if (!!cond) a.failed.push(msg);
}

// ───────────────────────────────────────────
// Rails helpers (consistent with other handler tests)
// ───────────────────────────────────────────
function railsSnapshot(ctx: any): {
  handlerStatus: any;
  status: any;
  responseStatus: any;
} {
  const handlerStatus = ctx?.get?.("handlerStatus") ?? "ok";
  const status = ctx?.get?.("status") ?? 200;
  const responseStatus = ctx?.get?.("response.status");
  return { handlerStatus, status, responseStatus };
}

function isRailsError(s: {
  handlerStatus: any;
  status: any;
  responseStatus: any;
}): boolean {
  return (
    s.handlerStatus === "error" ||
    (typeof s.status === "number" && s.status >= 500) ||
    (typeof s.responseStatus === "number" && s.responseStatus >= 500)
  );
}

type HandlerTestResult = {
  testId: string;
  name: string;
  outcome: "passed" | "failed";
  expectedError: boolean;
  assertionCount: number;
  failedAssertions: string[];
  errorMessage?: string;
  durationMs: number;
  railsVerdict: "ok" | "rails_error" | "test_bug";
  railsStatus?: number;
  railsHandlerStatus?: string;
  railsResponseStatus?: number;
};

// ───────────────────────────────────────────
// Scenario runner helper
// ───────────────────────────────────────────
async function runScenario(input: {
  deps: any;
  testId: string;
  name: string;
  expectedError: boolean;
  seed: {
    requestId: string;
    dtoType: string;
    op: string;

    userId?: string;
    userCreateStatus: UserCreateStatus;
    userAuthCreateStatus: UserAuthCreateStatus;
  };
  expectMint: boolean;
}): Promise<HandlerTestResult> {
  const startedAt = Date.now();
  const a: Assert = { count: 0, failed: [] };

  try {
    const ctx = input.deps.makeScenarioCtx({
      requestId: input.seed.requestId,
      dtoType: input.seed.dtoType,
      op: input.seed.op,
    });

    // Critical: mark expected-error scenarios so HandlerBase.failWithError()
    // downgrades ERROR logs during deliberate negative tests.
    if (input.expectedError === true) {
      ctx.set("expectErrors", true);
    }

    if (typeof input.seed.userId === "string") {
      ctx.set("signup.userId", input.seed.userId);
    }
    ctx.set("signup.userCreateStatus", input.seed.userCreateStatus);
    ctx.set("signup.userAuthCreateStatus", input.seed.userAuthCreateStatus);

    await input.deps.step.execute(ctx);

    const snap = railsSnapshot(ctx);
    const railsError = isRailsError(snap);

    assertEq(
      a,
      railsError,
      input.expectedError,
      input.expectedError
        ? "expected rails error but handler succeeded"
        : "unexpected rails error"
    );

    const expectedHandlerStatus = input.expectedError ? "error" : "ok";
    assertEq(
      a,
      String(snap.handlerStatus ?? ""),
      expectedHandlerStatus,
      `handlerStatus should be "${expectedHandlerStatus}"`
    );

    const httpStatus = (ctx.get("response.status") ??
      ctx.get("status") ??
      null) as unknown;

    if (input.expectedError) {
      if (httpStatus !== null) {
        assertEq(
          a,
          Number(httpStatus),
          500,
          "HTTP status must be 500 on mint error paths"
        );
      }
    } else {
      if (httpStatus !== null) {
        assertEq(
          a,
          Number(httpStatus),
          200,
          "HTTP status should be 200 on mint success"
        );
      }
    }

    const jwt = ctx.get("jwt.userAuth");
    const signupJwt = ctx.get("signup.jwt");

    if (input.expectMint) {
      assertOk(
        a,
        typeof jwt === "string" && (jwt as string).length > 0,
        "ctx['jwt.userAuth'] must be a non-empty string on success"
      );
      assertEq(
        a,
        signupJwt,
        jwt,
        "ctx['signup.jwt'] must match ctx['jwt.userAuth']"
      );

      const headerUnknown = ctx.get("signup.jwtHeader") as unknown;
      assertOk(
        a,
        headerUnknown && typeof headerUnknown === "object",
        "ctx['signup.jwtHeader'] must be an object on success"
      );
      const header = (headerUnknown ?? {}) as { alg?: unknown; kid?: unknown };

      assertOk(
        a,
        typeof header.alg === "string" && (header.alg as string).length > 0,
        "jwtHeader.alg must be a non-empty string"
      );
      assertOk(
        a,
        typeof header.kid === "string" && (header.kid as string).length > 0,
        "jwtHeader.kid must be a non-empty string"
      );

      const issuedAtUnknown = ctx.get("signup.jwtIssuedAt") as unknown;
      const expiresAtUnknown = ctx.get("signup.jwtExpiresAt") as unknown;

      assertOk(
        a,
        typeof issuedAtUnknown === "number" && Number.isFinite(issuedAtUnknown),
        "ctx['signup.jwtIssuedAt'] must be a finite number"
      );
      assertOk(
        a,
        typeof expiresAtUnknown === "number" &&
          Number.isFinite(expiresAtUnknown),
        "ctx['signup.jwtExpiresAt'] must be a finite number"
      );

      const issuedAt = issuedAtUnknown as number;
      const expiresAt = expiresAtUnknown as number;

      assertOk(a, expiresAt > issuedAt, "jwtExpiresAt must be > jwtIssuedAt");
    } else {
      assertFalse(
        a,
        !!jwt,
        "ctx['jwt.userAuth'] must not be set when mint does not run or fails"
      );
      assertFalse(
        a,
        !!signupJwt,
        "ctx['signup.jwt'] must not be set when mint does not run or fails"
      );
    }

    const finishedAt = Date.now();
    return {
      testId: input.testId,
      name: input.name,
      outcome: a.failed.length === 0 ? "passed" : "failed",
      expectedError: input.expectedError,
      assertionCount: a.count,
      failedAssertions: a.failed,
      errorMessage: a.failed[0],
      durationMs: Math.max(0, finishedAt - startedAt),
      railsVerdict: a.failed.length === 0 ? "ok" : "rails_error",
      railsStatus: snap.status,
      railsHandlerStatus: snap.handlerStatus,
      railsResponseStatus: snap.responseStatus,
    };
  } catch (err) {
    const finishedAt = Date.now();
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    return {
      testId: input.testId,
      name: input.name,
      outcome: "failed",
      expectedError: input.expectedError,
      assertionCount: a.count,
      failedAssertions: [msg],
      errorMessage: msg,
      durationMs: Math.max(0, finishedAt - startedAt),
      railsVerdict: "test_bug",
      railsStatus: undefined,
      railsHandlerStatus: undefined,
      railsResponseStatus: undefined,
    };
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
      expectedError: false,
      async run(): Promise<HandlerTestResult> {
        const requestId = "req-auth-mint-user-auth-token-happy";
        const userId = "mint-user-happy";

        return runScenario({
          deps,
          testId: "auth.signup.mintUserAuthToken.happy",
          name: "auth.signup: mintUserAuthToken mints a JWT (real env-service config)",
          expectedError: false,
          seed: {
            requestId,
            dtoType: "user",
            op: "code.mintUserAuthToken",
            userId,
            userCreateStatus: { ok: true, userId },
            userAuthCreateStatus: { ok: true },
          },
          expectMint: true,
        });
      },
    },
    {
      id: "auth.signup.mintUserAuthToken.missing-input",
      name: "auth.signup: mintUserAuthToken fails when signup.userId missing",
      shortCircuitOnFail: true,
      expectedError: true,
      async run(): Promise<HandlerTestResult> {
        const requestId = "req-auth-mint-user-auth-token-missing-input";

        return runScenario({
          deps,
          testId: "auth.signup.mintUserAuthToken.missing-input",
          name: "auth.signup: mintUserAuthToken fails when signup.userId missing",
          expectedError: true,
          seed: {
            requestId,
            dtoType: "user",
            op: "code.mintUserAuthToken",
            // Intentionally omit userId
            userCreateStatus: { ok: true },
            userAuthCreateStatus: { ok: true },
          },
          expectMint: false,
        });
      },
    },
  ];
}
