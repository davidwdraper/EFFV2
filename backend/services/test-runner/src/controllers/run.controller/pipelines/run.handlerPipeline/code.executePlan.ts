// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.executePlan.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing for service APIs.
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Execute the handler-level test list (ctx["testRunner.tests"]) and
 *   materialize test results as TestRunDto + TestHandlerDto DtoBags.
 *
 * Responsibilities:
 * - Generate a runId for this invocation.
 * - For each HandlerTestBase instance:
 *     • run the test,
 *     • classify result as pass | fail,
 *     • accumulate stats on a TestRunDto,
 *     • create a TestHandlerDto record per test.
 * - Store the resulting bags at:
 *     • ctx["testRunner.runBag"]     → DtoBag<TestRunDto>
 *     • ctx["testRunner.handlerBag"] → DtoBag<TestHandlerDto>
 *
 * Invariants:
 * - Does not call DbWriter directly; persistence is delegated to the
 *   test-log service via a later handler.
 * - Does not mutate ctx["bag"]; this is internal test-runner meta.
 */

import crypto from "crypto";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { DtoBag } from "@nv/shared/dto/DtoBag";
import { TestRunDto, type TestRunStatus } from "@nv/shared/dto/test-run.dto";
import {
  TestHandlerDto,
  type TestHandlerStatus,
} from "@nv/shared/dto/test-handler.dto";

import {
  HandlerTestBase,
  type HandlerTestResult,
} from "@nv/shared/http/handlers/testing/HandlerTestBase";

export class CodeExecutePlanHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Execute the handler-level test list and project results into TestRunDto/TestHandlerDto DtoBags.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const tests = this.ctx.get<HandlerTestBase[]>("testRunner.tests") ?? [];
    if (!Array.isArray(tests)) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_tests_invalid",
        detail:
          "ctx['testRunner.tests'] is not an array. Ops: ensure code.loadTests populates a HandlerTestBase[] list before code.executePlan.",
        stage: "testRunner.tests.invalid",
        requestId,
        rawError: null,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "test-runner.code.executePlan: ctx['testRunner.tests'] is not an array.",
        logLevel: "error",
      });
      return;
    }

    const envLabel = this.safeCtxGet<string>("envLabel") || "";
    let dbState = "";
    try {
      // DB_STATE is a logical state label; getVar guardrails are DB-safe.
      dbState = this.getVar("DB_STATE", false) || "";
    } catch {
      dbState = "";
    }

    const serviceSlug = "test-runner";
    const serviceVersion = 1;
    const runId = crypto.randomUUID();

    this.log.info(
      {
        event: "test_runner_execute_plan_start",
        requestId,
        runId,
        envLabel,
        dbState,
        testCount: tests.length,
      },
      "test-runner.code.executePlan: starting execution of handler tests."
    );

    const nowIso = new Date().toISOString();
    const runDto = new TestRunDto({
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    runDto.runId = runId;
    runDto.env = envLabel;
    runDto.dbState = dbState;
    runDto.serviceSlug = serviceSlug;
    runDto.serviceVersion = serviceVersion;
    runDto.controllerName = "run.controller";
    runDto.controllerPath =
      "controllers/run.controller/pipelines/run.handlerPipeline";
    runDto.pipelineLabel = "run.handlerPipeline";
    runDto.pipelinePath =
      "controllers/run.controller/pipelines/run.handlerPipeline";
    runDto.requestId = requestId;
    runDto.status = "error"; // pessimistic default

    const startedAt = Date.now();
    runDto.startedAt = new Date(startedAt).toISOString();

    const handlerDtos: TestHandlerDto[] = [];

    let handlerCount = 0;
    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      if (!test || typeof test.run !== "function") {
        this.log.warn(
          {
            event: "non_test_entry_skipped",
            runId,
            kind: typeof test,
          },
          "test-runner.code.executePlan: skipping non-HandlerTestBase entry in ctx['testRunner.tests']."
        );
        continue;
      }

      const result = await this.runSingleTest(test, {
        runId,
        envLabel,
        dbState,
        serviceSlug,
        serviceVersion,
        requestId,
      });

      handlerDtos.push(result.dto);
      handlerCount += 1;

      switch (result.dto.status as TestHandlerStatus) {
        case "pass":
          passed += 1;
          break;
        case "fail":
          failed += 1;
          break;
        default:
          // error/skip could be introduced later; treat non-pass as fail for now.
          failed += 1;
          break;
      }
    }

    const finishedAt = Date.now();
    runDto.finishedAt = new Date(finishedAt).toISOString();
    runDto.durationMs = Math.max(0, finishedAt - startedAt);

    runDto.handlerCount = handlerCount;
    runDto.passedHandlerCount = passed;
    runDto.failedHandlerCount = failed;
    runDto.errorHandlerCount = 0; // reserved for future error vs fail distinction

    let finalStatus: TestRunStatus = "pass";
    if (failed > 0) {
      finalStatus = "fail";
    }
    runDto.status = finalStatus;

    const runBag = new DtoBag<TestRunDto>([runDto]);
    const handlerBag = new DtoBag<TestHandlerDto>(handlerDtos);

    this.ctx.set("testRunner.runId", runId);
    this.ctx.set("testRunner.runBag", runBag);
    this.ctx.set("testRunner.handlerBag", handlerBag);

    this.log.info(
      {
        event: "test_runner_execute_plan_complete",
        requestId,
        runId,
        status: runDto.status,
        handlerCount: runDto.handlerCount,
        passedHandlerCount: runDto.passedHandlerCount,
        failedHandlerCount: runDto.failedHandlerCount,
        errorHandlerCount: runDto.errorHandlerCount,
      },
      "test-runner.code.executePlan: handler tests complete; results projected into TestRunDto/TestHandlerDto bags."
    );

    this.ctx.set("handlerStatus", "ok");
  }

  private async runSingleTest(
    test: HandlerTestBase,
    meta: {
      runId: string;
      envLabel: string;
      dbState: string;
      serviceSlug: string;
      serviceVersion: number;
      requestId: string;
    }
  ): Promise<{ dto: TestHandlerDto; raw: HandlerTestResult }> {
    const startedAt = Date.now();

    const raw = await test.run();

    const dto = new TestHandlerDto({
      createdAt: new Date(startedAt).toISOString(),
      updatedAt: new Date(startedAt).toISOString(),
    });

    dto.runId = meta.runId;
    dto.env = meta.envLabel;
    dto.dbState = meta.dbState;
    dto.serviceSlug = meta.serviceSlug;
    dto.serviceVersion = meta.serviceVersion;

    dto.controllerName = "run.controller";
    dto.pipelineLabel = "run.handlerPipeline";
    dto.pipelinePath =
      "controllers/run.controller/pipelines/run.handlerPipeline";

    // For now, use the test name as the handler label; we can refine later
    // if tests expose more detailed metadata.
    dto.handlerName = raw.name;
    dto.handlerPath = "(inline-test)";

    dto.dtoType = "(n/a)";
    dto.scenarioName = raw.testId;

    dto.requestId = meta.requestId;
    dto.startedAt = new Date(startedAt).toISOString();

    const durationMs = Math.max(0, raw.durationMs);
    const status: TestHandlerStatus =
      raw.outcome === "passed" ? "pass" : "fail";

    dto.status = status;
    dto.assertionCount = raw.assertionCount;
    dto.failedAssertions = raw.failedAssertions;
    dto.durationMs = durationMs;

    const finishedAt = startedAt + durationMs;
    dto.finishedAt = new Date(finishedAt).toISOString();

    return { dto, raw };
  }
}
