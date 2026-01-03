// backend/services/shared/src/testing/runTestScenario.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0094 (Test Scenario Error Handling and Logging)
 *
 * Purpose (single concern):
 * - Shared scenario harness for handler tests:
 *   - Outer try/catch/finally protects runner integrity
 *   - Inner try/catch/finally wraps scenario execution only
 *   - Both finally blocks call TestScenarioFinalizer (idempotent)
 *
 * Non-goals:
 * - NOT ALS.
 * - NOT logging.
 * - NOT runner policy.
 */

import { TestScenarioFinalizer } from "./TestScenarioFinalizer";
import type { TestExpectedMode } from "./TestScenarioStatus";
import type { TestScenarioStatus } from "./TestScenarioStatus";

export type ScenarioDepsLike = {
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

export async function runTestScenario(args: {
  deps: ScenarioDepsLike;

  testId: string;
  name: string;

  expectedMode: TestExpectedMode;
  status: TestScenarioStatus;

  dtoType?: string;
  op?: string;

  seedCtx: (ctx: any) => void;
}): Promise<{ ctx?: any }> {
  const dtoType = args.dtoType ?? "unknown";
  const op = args.op ?? "unknown";

  // Outer try/catch/finally protects runner integrity (ADR-0094).
  let ctx: any | undefined;

  try {
    // Inner try/catch/finally wraps ONLY scenario execution (ADR-0094).
    try {
      ctx = args.deps.makeScenarioCtx({
        requestId: `req-${args.testId}`,
        dtoType,
        op,
      });

      args.seedCtx(ctx);

      await args.deps.step.execute(ctx);
    } catch (err: any) {
      args.status.recordInnerCatch(err);
    } finally {
      // Always finalize from inner finally (idempotent).
      TestScenarioFinalizer.finalize({ status: args.status, ctx });
    }
  } catch (err: any) {
    // Only runner/test infrastructure errors should land here.
    args.status.recordOuterCatch(err);
  } finally {
    // Always finalize from outer finally as well (idempotent).
    TestScenarioFinalizer.finalize({ status: args.status, ctx });
  }

  return { ctx };
}
