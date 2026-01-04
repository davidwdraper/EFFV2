// backend/services/shared/src/http/handlers/code.mint.uuid.test.ts
/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0095 (Happy-Path-Only testing)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 *
 * Purpose:
 * - Happy-path smoke test for CodeMintUuidHandler:
 *   - mints a UUIDv4 to ctx["step.uuid"]
 *   - stays on the "ok" rail
 *
 * ADR-0095:
 * - Exactly one scenario: HappyPath
 */

import { createTestScenarioStatus } from "../../testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "../../testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "../../testing/TestScenarioFinalizer";

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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

export async function getScenarios(deps: ScenarioDepsLike) {
  return [
    {
      id: "HappyPath",
      name: "code.mint.uuid: mints UUIDv4 baton on ctx['step.uuid']",
      shortCircuitOnFail: true,

      async run(localDeps: ScenarioDepsLike): Promise<TestScenarioStatus> {
        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "code.mint.uuid: mints UUIDv4 baton on ctx['step.uuid']",
          expected: "success",
        });

        let ctx: any | undefined;

        try {
          ctx = localDeps.makeScenarioCtx({
            requestId: "req-code-mint-uuid",
            dtoType: "auth.signup",
            op: "mint.uuid",
          });

          try {
            await localDeps.step.execute(ctx);

            const handlerStatus = ctx.get("handlerStatus");
            if (handlerStatus !== "ok") {
              status.recordAssertionFailure(
                `Expected ctx['handlerStatus']="ok" but got "${String(
                  handlerStatus
                )}".`
              );
            }

            const uuid = ctx.get("step.uuid");
            if (!isUuidV4(uuid)) {
              status.recordAssertionFailure(
                `Expected ctx['step.uuid'] to be UUIDv4 but got "${String(
                  uuid
                )}".`
              );
            }
          } catch (err: any) {
            status.recordInnerCatch(err);
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
