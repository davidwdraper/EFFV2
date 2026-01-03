// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.build.userId.test.ts
/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 *
 * Purpose:
 * - Smoke test for CodeBuildUserIdHandler:
 *   - ensure a valid UUIDv4 is written to ctx["signup.userId"]
 *   - ensure handler remains on the "ok" rail (HTTP 200)
 *
 * ADR-0094 contract:
 * - Scenario.run(deps) returns TestScenarioStatus (no HandlerTestBase / no expectErrors).
 * - Inner try/catch wraps ONLY handler execution.
 * - Outer try/catch protects runner integrity.
 * - Finalization is deterministic via TestScenarioFinalizer.
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

function isUuidV4(v: unknown): boolean {
  if (typeof v !== "string") return false;
  // UUIDv4: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

export async function getScenarios(deps: ScenarioDepsLike) {
  return [
    {
      id: "auth.signup.code.build.userId.happy",
      name: "auth.signup: CodeBuildUserIdHandler mints UUIDv4 on ctx['signup.userId']",
      shortCircuitOnFail: true,

      async run(localDeps: ScenarioDepsLike): Promise<TestScenarioStatus> {
        const testId = "auth.signup.code.build.userId.happy";
        const name =
          "auth.signup: CodeBuildUserIdHandler mints UUIDv4 on ctx['signup.userId']";

        const status = createTestScenarioStatus({
          scenarioId: testId,
          scenarioName: name,
          expected: "success",
        });

        let ctx: any | undefined;

        // Outer try/catch protects runner integrity (ADR-0094).
        try {
          // Inner try/catch wraps ONLY handler execution (ADR-0094).
          try {
            ctx = localDeps.makeScenarioCtx({
              requestId: "req-auth-signup-build-user-id",
              dtoType: "auth.signup",
              op: "build.userId",
            });

            await localDeps.step.execute(ctx);

            // Assertions MUST NOT throw (ADR-0094):
            // - Test failures should be outcomeCode=3 (red, INFO), not infrastructure aborts.
            const handlerStatus = ctx.get("handlerStatus");
            if (handlerStatus !== "ok") {
              status.recordAssertionFailure(
                `Expected ctx['handlerStatus']="ok" but got "${String(
                  handlerStatus
                )}".`
              );
            }

            const userId = ctx.get("signup.userId");
            if (!isUuidV4(userId)) {
              status.recordAssertionFailure(
                `Expected ctx['signup.userId'] to be UUIDv4 but got "${String(
                  userId
                )}".`
              );
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
      },
    },
  ];
}
