// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.extractPassword.test.ts
/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Verify CodeExtractPasswordHandler behavior for:
 *   • valid header (happy)
 *   • weak password (length)
 *   • missing password header
 *
 * IMPORTANT:
 * - This is a *runner-shaped* test module.
 * - It executes handlers via deps.step.execute(ctx), not via HandlerTestBase,
 *   so the scenario ctx always inherits pipeline runtime ("rt").
 * - This avoids stub-controller failures in SvcRuntime’d handlers.
 *
 * Invariants:
 * - Tests must never log the raw password value; only length is inspected/logged.
 * - Handler-level tests assert handlerStatus + context mutations, not HTTP codes.
 */

const HEADER_NAME = "x-nv-password";

// ───────────────────────────────────────────
// Minimal assertion helpers (no abstractions)
// ───────────────────────────────────────────

type AssertAcc = {
  count: number;
  failed: string[];
};

function assertEq(
  a: AssertAcc,
  actual: unknown,
  expected: unknown,
  msg: string
): void {
  a.count += 1;
  if (actual !== expected) {
    a.failed.push(`${msg} expected=${String(expected)} got=${String(actual)}`);
  }
}

function assertOk(a: AssertAcc, cond: unknown, msg: string): void {
  a.count += 1;
  if (!cond) {
    a.failed.push(msg);
  }
}

// ───────────────────────────────────────────
// Rails helpers
// ───────────────────────────────────────────

function railsSnapshot(ctx: any): {
  handlerStatus: string;
  status: number;
  responseStatus?: number;
} {
  const handlerStatus = (ctx?.get?.("handlerStatus") as string) ?? "ok";
  const status = (ctx?.get?.("status") as number) ?? 200;
  const responseStatus = ctx?.get?.("response.status") as number | undefined;

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
// Scenario runner helper
// ───────────────────────────────────────────

async function runScenario(input: {
  deps: any; // ScenarioDeps (kept as any to avoid import drift)
  testId: string;
  name: string;
  expectedError: boolean;
  seed: {
    requestId: string;
    dtoType: string;
    op: string;
    headers: Record<string, string>;
  };
  expectPasswordStored: boolean;
}) {
  const startedAt = Date.now();
  const a: AssertAcc = { count: 0, failed: [] };

  try {
    const ctx = input.deps.makeScenarioCtx({
      requestId: input.seed.requestId,
      dtoType: input.seed.dtoType,
      op: input.seed.op,
    });

    // Seed headers explicitly on the runner-provided ctx
    ctx.set("headers", { ...(input.seed.headers ?? {}) });

    // Execute handler in production shape
    await input.deps.step.execute(ctx);

    const snap = railsSnapshot(ctx);
    const railsError = isRailsError(snap);

    // Rails expectation
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

    const stored = ctx.get("signup.passwordClear");

    if (input.expectPasswordStored) {
      assertOk(
        a,
        typeof stored === "string" && (stored as string).length > 0,
        "signup.passwordClear should be stored as a non-empty string"
      );
    } else {
      assertOk(
        a,
        typeof stored === "undefined",
        "signup.passwordClear must not be set on error paths"
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
  } catch (err: any) {
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
      id: "auth.signup.code.extractPassword.happy",
      name: "auth.signup: CodeExtractPasswordHandler extracts valid password",
      shortCircuitOnFail: true,
      expectedError: false,
      async run() {
        return runScenario({
          deps,
          testId: "auth.signup.code.extractPassword.happy",
          name: "auth.signup: CodeExtractPasswordHandler extracts valid password",
          expectedError: false,
          seed: {
            requestId: "req-auth-extractPassword-happy",
            dtoType: "user",
            op: "code.extractPassword",
            headers: {
              [HEADER_NAME]: "StrongPassw0rd#",
            },
          },
          expectPasswordStored: true,
        });
      },
    },
    {
      id: "auth.signup.code.extractPassword.weak",
      name: "auth.signup: CodeExtractPasswordHandler rejects weak password by length",
      shortCircuitOnFail: false,
      expectedError: true,
      async run() {
        return runScenario({
          deps,
          testId: "auth.signup.code.extractPassword.weak",
          name: "auth.signup: CodeExtractPasswordHandler rejects weak password by length",
          expectedError: true,
          seed: {
            requestId: "req-auth-extractPassword-weak",
            dtoType: "user",
            op: "code.extractPassword",
            headers: {
              [HEADER_NAME]: "short",
            },
          },
          expectPasswordStored: false,
        });
      },
    },
    {
      id: "auth.signup.code.extractPassword.missing",
      name: "auth.signup: CodeExtractPasswordHandler fails when password header is missing",
      shortCircuitOnFail: false,
      expectedError: true,
      async run() {
        return runScenario({
          deps,
          testId: "auth.signup.code.extractPassword.missing",
          name: "auth.signup: CodeExtractPasswordHandler fails when password header is missing",
          expectedError: true,
          seed: {
            requestId: "req-auth-extractPassword-missing",
            dtoType: "user",
            op: "code.extractPassword",
            headers: {},
          },
          expectPasswordStored: false,
        });
      },
    },
  ];
}
