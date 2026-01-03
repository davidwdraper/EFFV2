// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.extractPassword.test.ts
/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Verify CodeExtractPasswordHandler behavior for:
 *   • valid header (happy)
 *   • weak password (length)
 *   • missing password header
 *
 * IMPORTANT:
 * - Runner-shaped test module.
 * - Executes handlers via deps.step.execute(ctx) so scenario ctx inherits pipeline runtime ("rt").
 *
 * Invariants:
 * - Tests must never log the raw password value; only length is inspected.
 * - Handler-level tests assert handlerStatus + context mutations.
 *
 * ADR-0094 contract:
 * - No expectErrors anywhere.
 * - Scenario.run returns TestScenarioStatus.
 * - Inner try/catch wraps ONLY handler execution.
 * - Outer try/catch protects runner integrity.
 * - Finalization is deterministic via TestScenarioFinalizer.
 */

import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type {
  TestScenarioStatus,
  TestExpectedMode,
} from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";

const HEADER_NAME = "x-nv-password";

// ───────────────────────────────────────────
// Minimal rails helpers (no abstractions)
// ───────────────────────────────────────────

function railsSnapshot(ctx: any): {
  handlerStatus: string;
  httpStatus: number;
} {
  const handlerStatus = (ctx?.get?.("handlerStatus") as string) ?? "ok";

  // Prefer response.status if present.
  const httpStatus =
    (ctx?.get?.("response.status") as number | undefined) ??
    (ctx?.get?.("status") as number | undefined) ??
    200;

  return { handlerStatus, httpStatus };
}

function isPasswordStored(ctx: any): boolean {
  const stored = ctx?.get?.("signup.passwordClear");
  return typeof stored === "string" && stored.length > 0;
}

// ───────────────────────────────────────────
// Scenario runner helper
// ───────────────────────────────────────────

async function runScenario(input: {
  deps: any; // ScenarioDeps (kept as any to avoid import drift)
  testId: string;
  name: string;

  expectedMode: TestExpectedMode;
  expectedHttpStatus?: number;

  seed: {
    requestId: string;
    dtoType: string;
    op: string;
    headers: Record<string, string>;
  };

  expectPasswordStored: boolean;
}): Promise<TestScenarioStatus> {
  const status = createTestScenarioStatus({
    scenarioId: input.testId,
    scenarioName: input.name,
    expected: input.expectedMode,
  });

  let ctx: any | undefined;

  // Outer try/catch protects runner integrity.
  try {
    // Inner try/catch wraps ONLY handler execution.
    try {
      ctx = input.deps.makeScenarioCtx({
        requestId: input.seed.requestId,
        dtoType: input.seed.dtoType,
        op: input.seed.op,
      });

      // Seed headers explicitly on the runner-provided ctx.
      ctx.set("headers", { ...(input.seed.headers ?? {}) });

      // Execute handler in production shape.
      await input.deps.step.execute(ctx);

      const snap = railsSnapshot(ctx);

      // “Legitimate failure” enforcement:
      // If a scenario expects a specific HTTP status (e.g., 400/401/409/500),
      // anything else is treated as a real test failure (Outcome 3, red, INFO).
      if (typeof input.expectedHttpStatus === "number") {
        if (snap.httpStatus !== input.expectedHttpStatus) {
          status.recordAssertionFailure(
            `Expected httpStatus=${input.expectedHttpStatus} but got httpStatus=${snap.httpStatus}.`
          );
        }
      }

      const stored = isPasswordStored(ctx);

      if (input.expectPasswordStored) {
        if (!stored) {
          status.recordAssertionFailure(
            "signup.passwordClear should be stored as a non-empty string."
          );
        }
      } else {
        if (stored) {
          status.recordAssertionFailure(
            "signup.passwordClear must not be set on error paths."
          );
        }
      }
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
// ScenarioRunner entrypoint
// ───────────────────────────────────────────

export async function getScenarios(deps: any) {
  return [
    {
      id: "auth.signup.code.extractPassword.happy",
      name: "auth.signup: CodeExtractPasswordHandler extracts valid password",
      shortCircuitOnFail: true,

      async run() {
        return runScenario({
          deps,
          testId: "auth.signup.code.extractPassword.happy",
          name: "auth.signup: CodeExtractPasswordHandler extracts valid password",
          expectedMode: "success",
          expectedHttpStatus: 200,
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

      async run() {
        return runScenario({
          deps,
          testId: "auth.signup.code.extractPassword.weak",
          name: "auth.signup: CodeExtractPasswordHandler rejects weak password by length",
          expectedMode: "failure",
          // If this handler returns a specific 4xx (likely 400), lock it here.
          // If you later standardize a different code, changing this is intentional breakage.
          expectedHttpStatus: 400,
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

      async run() {
        return runScenario({
          deps,
          testId: "auth.signup.code.extractPassword.missing",
          name: "auth.signup: CodeExtractPasswordHandler fails when password header is missing",
          expectedMode: "failure",
          expectedHttpStatus: 400,
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
