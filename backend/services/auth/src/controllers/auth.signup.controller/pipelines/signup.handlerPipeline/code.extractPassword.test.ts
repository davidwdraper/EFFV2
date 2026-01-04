// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.extractPassword.test.ts
/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0095 (Happy-Path-Only testing)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Happy-path smoke test for CodeExtractPasswordHandler:
 *   • extracts a valid password from header x-nv-password
 *   • stores it on ctx["signup.passwordClear"]
 *
 * IMPORTANT:
 * - Runner-shaped test module.
 * - Executes handlers via deps.step.execute(ctx) so scenario ctx inherits pipeline runtime ("rt").
 *
 * Invariants:
 * - Tests must never log the raw password value; only presence is inspected.
 * - Handler-level tests assert handlerStatus + context mutations.
 *
 * ADR-0095:
 * - Exactly one scenario: HappyPath
 *
 * ADR-0094 contract:
 * - No expectErrors anywhere.
 * - Scenario.run returns TestScenarioStatus.
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

const HEADER_NAME = "x-nv-password";

function isPasswordStored(ctx: any): boolean {
  const stored = ctx?.get?.("signup.passwordClear");
  return typeof stored === "string" && stored.length > 0;
}

export async function getScenarios(deps: ScenarioDepsLike) {
  return [
    {
      id: "HappyPath",
      name: "auth.signup: CodeExtractPasswordHandler extracts valid password",
      shortCircuitOnFail: true,

      async run(localDeps: ScenarioDepsLike): Promise<TestScenarioStatus> {
        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "auth.signup: CodeExtractPasswordHandler extracts valid password",
          expected: "success",
        });

        let ctx: any | undefined;

        // Outer try/catch protects runner integrity (ADR-0094).
        try {
          ctx = localDeps.makeScenarioCtx({
            requestId: "req-auth-extractPassword-happy",
            dtoType: "user",
            op: "code.extractPassword",
          });

          // Seed headers explicitly on the runner-provided ctx.
          ctx.set("headers", { [HEADER_NAME]: "StrongPassw0rd#" });

          // Inner try/catch wraps ONLY handler execution (ADR-0094).
          try {
            await localDeps.step.execute(ctx);

            // Assertions MUST NOT throw (ADR-0094).
            const handlerStatus = ctx.get("handlerStatus");
            if (String(handlerStatus ?? "") !== "ok") {
              status.recordAssertionFailure(
                `Expected handlerStatus="ok" but got "${String(
                  handlerStatus ?? ""
                )}".`
              );
            }

            if (!isPasswordStored(ctx)) {
              status.recordAssertionFailure(
                "Expected ctx['signup.passwordClear'] to be a non-empty string."
              );
            }
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
