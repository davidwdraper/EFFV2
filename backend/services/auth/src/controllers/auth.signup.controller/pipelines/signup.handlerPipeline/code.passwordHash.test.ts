// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.passwordHash.test.ts
/**
 * Docs:
 * - LDD-40 (Handler Test Design — runner-shaped)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 *
 * Purpose:
 * - Runner-shaped handler tests for CodePasswordHashHandler.
 *
 * IMPORTANT:
 * - Tests execute handlers via deps.step.execute(ctx).
 * - Scenario ctx is created via deps.makeScenarioCtx(), inheriting runtime ("rt").
 * - This avoids stub-controller + missing runtime failures.
 */

type AssertState = { count: number; failed: string[] };

function assertEq(
  a: AssertState,
  actual: unknown,
  expected: unknown,
  msg: string
): void {
  a.count += 1;
  if (actual !== expected) {
    a.failed.push(`${msg} expected=${String(expected)} got=${String(actual)}`);
  }
}

function assertOk(a: AssertState, cond: unknown, msg: string): void {
  a.count += 1;
  if (!cond) a.failed.push(msg);
}

// ───────────────────────────────────────────
// Rails helpers
// ───────────────────────────────────────────
function railsSnapshot(ctx: any) {
  const handlerStatus = ctx?.get?.("handlerStatus") ?? "ok";
  const status = ctx?.get?.("status") ?? 200;
  const responseStatus = ctx?.get?.("response.status");
  return { handlerStatus, status, responseStatus };
}

function isRailsError(s: {
  handlerStatus: string;
  status: number;
  responseStatus?: number;
}): boolean {
  return (
    s.handlerStatus === "error" ||
    s.status >= 500 ||
    (typeof s.responseStatus === "number" && s.responseStatus >= 500)
  );
}

// ───────────────────────────────────────────
// Scenario executor
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
    passwordClear?: string;
    injectHashFn?: (
      password: string,
      salt: string | Buffer,
      keylen: number
    ) => Buffer;
  };
  expectHash: boolean;
}): Promise<any> {
  const startedAt = Date.now();
  const a: AssertState = { count: 0, failed: [] };

  try {
    const ctx = input.deps.makeScenarioCtx({
      requestId: input.seed.requestId,
      dtoType: input.seed.dtoType,
      op: input.seed.op,
    });

    if (typeof input.seed.passwordClear === "string") {
      ctx.set("signup.passwordClear", input.seed.passwordClear);
    }

    if (input.seed.injectHashFn) {
      ctx.set("signup.passwordHashFn", input.seed.injectHashFn);
    }

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
      snap.handlerStatus,
      expectedHandlerStatus,
      `handlerStatus should be "${expectedHandlerStatus}"`
    );

    const hash = ctx.get("signup.hash");
    const algo = ctx.get("signup.hashAlgo");
    const params = ctx.get("signup.hashParamsJson");
    const cleared = ctx.get("signup.passwordClear");

    if (input.expectHash) {
      assertOk(
        a,
        typeof hash === "string" && hash.length > 0,
        "signup.hash should be set"
      );
      assertEq(a, algo, "scrypt", "hash algorithm should be scrypt");
      assertOk(
        a,
        typeof params === "string" && params.length > 0,
        "signup.hashParamsJson should be set"
      );
      assertOk(
        a,
        typeof cleared === "undefined",
        "signup.passwordClear must be cleared after hashing"
      );
    } else {
      assertOk(
        a,
        typeof hash === "undefined" || hash === null,
        "signup.hash must not be set on failure paths"
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
      failedAssertions: a.failed.length ? a.failed : [msg],
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
export async function getScenarios(deps: any) {
  return [
    {
      id: "auth.signup.code.passwordHash.happy",
      name: "auth.signup: CodePasswordHashHandler derives hash, algo, params, and clears cleartext password",
      shortCircuitOnFail: true,
      expectedError: false,
      async run() {
        return runScenario({
          deps,
          testId: "auth.signup.code.passwordHash.happy",
          name: "auth.signup: CodePasswordHashHandler derives hash, algo, params, and clears cleartext password",
          expectedError: false,
          seed: {
            requestId: "req-auth-passwordHash-happy",
            dtoType: "user",
            op: "code.passwordHash",
            passwordClear: "StrongPassw0rd#",
          },
          expectHash: true,
        });
      },
    },
    {
      id: "auth.signup.code.passwordHash.missingPassword",
      name: "auth.signup: CodePasswordHashHandler fails when signup.passwordClear is missing",
      shortCircuitOnFail: false,
      expectedError: true,
      async run() {
        return runScenario({
          deps,
          testId: "auth.signup.code.passwordHash.missingPassword",
          name: "auth.signup: CodePasswordHashHandler fails when signup.passwordClear is missing",
          expectedError: true,
          seed: {
            requestId: "req-auth-passwordHash-missingPassword",
            dtoType: "user",
            op: "code.passwordHash",
          },
          expectHash: false,
        });
      },
    },
    {
      id: "auth.signup.code.passwordHash.hashFailure",
      name: "auth.signup: CodePasswordHashHandler reports 500 when hashing fails (scrypt error)",
      shortCircuitOnFail: false,
      expectedError: true,
      async run() {
        return runScenario({
          deps,
          testId: "auth.signup.code.passwordHash.hashFailure",
          name: "auth.signup: CodePasswordHashHandler reports 500 when hashing fails (scrypt error)",
          expectedError: true,
          seed: {
            requestId: "req-auth-passwordHash-failure",
            dtoType: "user",
            op: "code.passwordHash",
            passwordClear: "AnotherStrongPass#1",
            injectHashFn: () => {
              throw new Error("TEST_FORCED_SCRYPT_FAILURE");
            },
          },
          expectHash: false,
        });
      },
    },
  ];
}
