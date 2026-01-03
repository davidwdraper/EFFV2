// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.passwordHash.test.ts
/**
 * Docs:
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0040 (DTO-Only Persistence; edge → DTO)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 *
 * Purpose (THIS SESSION):
 * - First retrofit of a handler test to ADR-0094:
 *   - No test semantics via ctx flags.
 *   - Inner/outer try/catch/finally.
 *   - Scenario outcome computed via shared TestScenarioStatus + TestScenarioFinalizer.
 *
 * IMPORTANT:
 * - We are NOT building ALS. Remove/avoid any “adaptive logging” patterns here.
 * - Runner contract remains: getScenarios(deps) returns defs with scenario.run(deps).
 *
 * Transitional note (until ScenarioRunner consumes TestScenarioStatus directly):
 * - We still return HandlerTestResult to satisfy the current runner contract.
 * - The TestScenarioStatus is the source of truth; we map to legacy shape at the end.
 */

import * as crypto from "crypto";

import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";
import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";

/**
 * Minimal local contract:
 * - DO NOT import test-runner source across services.
 * - Structural typing is enough for the runner to call getScenarios(deps) and scenario.run(deps).
 */
type ScenarioDeps = {
  step: {
    handlerName: string;
    execute: (scenarioCtx: any) => Promise<void>;
  };

  makeScenarioCtx: (seed: {
    requestId: string;
    dtoType?: string;
    op?: string;
  }) => any;
};

type HandlerTestScenarioDef = {
  id: string;
  name: string;

  /**
   * Legacy field required by current runner contracts.
   * This remains metadata until runner consumes TestScenarioStatus directly.
   */
  expectedError: boolean;

  shortCircuitOnFail?: boolean;
  run: (deps: ScenarioDeps) => Promise<HandlerTestResult>;
};

// Small helper: produce a HandlerTestResult without pulling in HandlerTestBase.
function makeResult(input: {
  testId: string;
  name: string;
  outcome: "passed" | "failed";
  expectedError: boolean;
  errorMessage?: string;
  failedAssertions?: string[];
  railsHandlerStatus?: unknown;
  railsResponseStatus?: unknown;
}): HandlerTestResult {
  return {
    testId: input.testId,
    name: input.name,
    outcome: input.outcome,
    expectedError: input.expectedError,
    assertionCount: Array.isArray(input.failedAssertions)
      ? input.failedAssertions.length
      : 0,
    failedAssertions: Array.isArray(input.failedAssertions)
      ? input.failedAssertions
      : [],
    errorMessage: input.errorMessage,
    durationMs: 0,
    railsVerdict: undefined,
    railsStatus: undefined,
    railsHandlerStatus: input.railsHandlerStatus as any,
    railsResponseStatus: input.railsResponseStatus as any,
  };
}

function readHttpStatus(ctx: any): number {
  const v = ctx.get("response.status") ?? ctx.get("status") ?? 200;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 200;
}

function readHandlerStatus(ctx: any): string {
  const v = ctx.get("handlerStatus");
  return typeof v === "string" ? v : "ok";
}

function pickFailureMessages(status: TestScenarioStatus): string[] {
  // Prefer explicit assertion failures if present (Outcome 3).
  try {
    const fails = status.assertionFailures?.();
    if (Array.isArray(fails) && fails.length) return fails;
  } catch {}
  // Otherwise, if an error was caught, surface its message.
  const caught = status.caught?.();
  if (caught?.message) return [caught.message];
  return [];
}

async function runScenario(args: {
  deps: ScenarioDeps;
  testId: string;
  name: string;
  expectedMode: "success" | "failure";
  expectedHttpStatus?: number;
  seedCtx: (ctx: any) => void;
  assertAfter?: (ctx: any, status: TestScenarioStatus) => void;
}): Promise<HandlerTestResult> {
  const {
    deps,
    testId,
    name,
    expectedMode,
    expectedHttpStatus,
    seedCtx,
    assertAfter,
  } = args;

  const status = createTestScenarioStatus({
    scenarioId: testId,
    scenarioName: name,
    expected: expectedMode,
  });

  const expectedErrorMeta = expectedMode === "failure";

  // Outer try/catch/finally protects runner integrity (ADR-0094).
  let ctx: any | undefined;

  try {
    // Inner try/catch/finally wraps ONLY scenario execution (ADR-0094).
    try {
      ctx = deps.makeScenarioCtx({
        requestId: `req-${testId}`,
        dtoType: "user",
        op: "code.passwordHash",
      });

      seedCtx(ctx);

      await deps.step.execute(ctx);

      // Post-execution assertions must not throw; record them on status.
      if (assertAfter) {
        assertAfter(ctx, status);
      }
    } catch (err: any) {
      status.recordInnerCatch(err);
    } finally {
      // Always finalize from inner finally (idempotent).
      TestScenarioFinalizer.finalize({ status, ctx });
    }
  } catch (err: any) {
    // Only runner/test infrastructure errors should land here.
    status.recordOuterCatch(err);
  } finally {
    // Always finalize from outer finally as well (idempotent).
    TestScenarioFinalizer.finalize({ status, ctx });
  }

  // Translate deterministic status + rails snapshot into legacy HandlerTestResult.
  const snap = status.rails();
  const handlerStatus =
    snap?.handlerStatus ?? (ctx ? readHandlerStatus(ctx) : "ok");
  const httpStatus = snap?.httpStatus ?? (ctx ? readHttpStatus(ctx) : 200);

  const finalOutcome = status.outcome();
  if (!finalOutcome) {
    return makeResult({
      testId,
      name,
      outcome: "failed",
      expectedError: expectedErrorMeta,
      errorMessage:
        "TestScenarioStatus did not finalize an outcome (infrastructure bug).",
      failedAssertions: [
        "TestScenarioStatus did not finalize an outcome (infrastructure bug).",
      ],
      railsHandlerStatus: handlerStatus,
      railsResponseStatus: httpStatus,
    });
  }

  // “Legitimacy” lock: if a specific HTTP status is expected, anything else is a failure.
  if (
    typeof expectedHttpStatus === "number" &&
    httpStatus !== expectedHttpStatus
  ) {
    const msg = `Expected httpStatus=${expectedHttpStatus} but got httpStatus=${httpStatus} (handlerStatus=${handlerStatus}).`;
    return makeResult({
      testId,
      name,
      outcome: "failed",
      expectedError: expectedErrorMeta,
      errorMessage: msg,
      failedAssertions: [msg],
      railsHandlerStatus: handlerStatus,
      railsResponseStatus: httpStatus,
    });
  }

  const failures = pickFailureMessages(status);

  // Legacy mapping:
  // - Green outcomes => passed
  // - Red outcomes   => failed (INFO severity handled by runner later; we do not log here)
  return makeResult({
    testId,
    name,
    outcome: finalOutcome.color === "green" ? "passed" : "failed",
    expectedError: expectedErrorMeta,
    errorMessage: finalOutcome.color === "red" ? failures[0] : undefined,
    failedAssertions: finalOutcome.color === "red" ? failures : [],
    railsHandlerStatus: handlerStatus,
    railsResponseStatus: httpStatus,
  });
}

/**
 * ScenarioRunner entrypoint.
 */
export async function getScenarios(
  deps: ScenarioDeps
): Promise<HandlerTestScenarioDef[]> {
  return [
    {
      id: "auth.signup.code.passwordHash.happy",
      name: "auth.signup: CodePasswordHashHandler derives hash, algo, params, and clears cleartext password",
      shortCircuitOnFail: true,
      expectedError: false,

      async run(runDeps: ScenarioDeps): Promise<HandlerTestResult> {
        return runScenario({
          deps: runDeps,
          testId: "auth.signup.code.passwordHash.happy",
          name: "auth.signup: CodePasswordHashHandler derives hash, algo, params, and clears cleartext password",
          expectedMode: "success",
          expectedHttpStatus: 200,
          seedCtx: (ctx) => {
            ctx.set("signup.passwordClear", "StrongPassw0rd#");
          },
          assertAfter: (ctx, status) => {
            const handlerStatus = String(ctx.get("handlerStatus") ?? "ok");
            if (handlerStatus !== "ok") {
              status.recordAssertionFailure(
                `Expected handlerStatus="ok" but got "${handlerStatus}".`
              );
            }

            const clear = ctx.get("signup.passwordClear");
            if (typeof clear !== "undefined") {
              status.recordAssertionFailure(
                "Expected signup.passwordClear to be cleared (undefined)."
              );
            }

            const hash = ctx.get("signup.passwordHash");
            if (typeof hash !== "string" || hash.length < 16) {
              status.recordAssertionFailure(
                "Expected signup.passwordHash to be a non-empty string."
              );
            }

            const algo = ctx.get("signup.passwordAlgo");
            if (typeof algo !== "string" || !algo.trim()) {
              status.recordAssertionFailure(
                "Expected signup.passwordAlgo to be a non-empty string."
              );
            }
          },
        });
      },
    },

    {
      id: "auth.signup.code.passwordHash.missingPassword",
      name: "auth.signup: CodePasswordHashHandler fails when signup.passwordClear is missing",
      shortCircuitOnFail: false,
      expectedError: true,

      async run(runDeps: ScenarioDeps): Promise<HandlerTestResult> {
        return runScenario({
          deps: runDeps,
          testId: "auth.signup.code.passwordHash.missingPassword",
          name: "auth.signup: CodePasswordHashHandler fails when signup.passwordClear is missing",
          expectedMode: "failure",
          // Lock this later once you standardize the status (400 vs 422).
          expectedHttpStatus: undefined,
          seedCtx: (_ctx) => {
            // Intentionally do NOT seed ctx['signup.passwordClear'].
          },
          assertAfter: (ctx, status) => {
            const handlerStatus = String(ctx.get("handlerStatus") ?? "ok");
            if (handlerStatus !== "error") {
              status.recordAssertionFailure(
                `Expected handlerStatus="error" but got "${handlerStatus}".`
              );
            }
          },
        });
      },
    },

    {
      id: "auth.signup.code.passwordHash.hashFailure",
      name: "auth.signup: CodePasswordHashHandler reports 500 when hashing fails (scrypt error)",
      shortCircuitOnFail: false,
      expectedError: true,

      async run(runDeps: ScenarioDeps): Promise<HandlerTestResult> {
        return runScenario({
          deps: runDeps,
          testId: "auth.signup.code.passwordHash.hashFailure",
          name: "auth.signup: CodePasswordHashHandler reports 500 when hashing fails (scrypt error)",
          expectedMode: "failure",
          expectedHttpStatus: 500,
          seedCtx: (ctx) => {
            ctx.set("signup.passwordClear", "AnotherStrongPass#1");

            const failingScrypt = ((
              _password: crypto.BinaryLike,
              _salt: crypto.BinaryLike,
              _keylen: number,
              _options?: crypto.ScryptOptions
            ): Buffer => {
              throw new Error("TEST_FORCED_SCRYPT_FAILURE");
            }) as unknown as typeof crypto.scryptSync;

            ctx.set("signup.passwordHashFn", failingScrypt);
          },
          assertAfter: (ctx, status) => {
            const handlerStatus = String(ctx.get("handlerStatus") ?? "ok");
            if (handlerStatus !== "error") {
              status.recordAssertionFailure(
                `Expected handlerStatus="error" but got "${handlerStatus}".`
              );
            }
          },
        });
      },
    },
  ];
}
