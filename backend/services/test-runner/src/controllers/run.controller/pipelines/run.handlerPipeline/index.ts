// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Define ordered handler steps for the test-runner RUN pipeline.
 * - Controller stays thin; this module owns orchestration (order only).
 *
 * Invariants:
 * - Handlers are single-purpose and constructed per request via this factory.
 * - Guard runs first; logging runs last.
 *
 * Persistence flow (per session design):
 *  1) Early: create TestRun (status=started) so crashes still leave a breadcrumb.
 *  2) Late: create TestHandler results (second last).
 *  3) Final: update TestRun with duration + completed status.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { CodeGuardDbStateAndMockModeHandler } from "./code.guard.dbStateAndMockMode";
import { CodeTreeWalkerHandler } from "./code.treeWalker";
import { CodePlanRunsHandler } from "./code.planRuns";
import { CodeSeedRunHandler } from "./code.seedRun";
import { CodeLoadTestsHandler } from "./code.loadTests";
import { CodeExecutePlanHandler } from "./code.executePlan";

import { S2sLogTestRunStartHandler } from "./s2s.logTestRunStart";
import { S2sLogTestHandlersHandler } from "./s2s.logTestHandlers";
import { S2sLogToTestLogHandler } from "./s2s.logToTestLog";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  return [
    // 0) Hard guard: DB_STATE / DB_MOCKS safety + mockMode selection.
    new CodeGuardDbStateAndMockModeHandler(ctx, controller),

    // 1) Walk the code tree to discover pipelines/handlers suitable for testing.
    new CodeTreeWalkerHandler(ctx, controller),

    // 2) Plan which runs/pipelines to execute (planning only).
    new CodePlanRunsHandler(ctx, controller),

    // 3) Seed an invocation-level TestRunDto (status=started) into ctx["testRunner.runBag"].
    new CodeSeedRunHandler(ctx, controller),

    // 4) Persist a STARTED test-run record (early breadcrumb).
    new S2sLogTestRunStartHandler(ctx, controller),

    // 5) Load tests into handler instances for execution.
    new CodeLoadTestsHandler(ctx, controller),

    // 6) Execute the planned tests/pipelines and finalize the invocation runBag fields.
    new CodeExecutePlanHandler(ctx, controller),

    // 7) Persist test-handler results (second last).
    new S2sLogTestHandlersHandler(ctx, controller),

    // 8) Finalize the test-run (duration + completed status) via UPDATE.
    new S2sLogToTestLogHandler(ctx, controller),
  ];
}
