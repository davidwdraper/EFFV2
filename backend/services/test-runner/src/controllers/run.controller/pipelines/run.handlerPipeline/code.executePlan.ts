// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.executePlan.ts
/**
 * Docs:
 * - SOP + ADR-0073
 *
 * Logging:
 * - INFO once: counts (pass/fail/total).
 * - WARN once: list of failed tests (only if failures exist).
 *
 * Output:
 * - Sets ctx["bag"] to the singleton TestRunDto runBag so curl output is lean.
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
    return "Execute handler-level tests and project results into TestRunDto/TestHandlerDto DtoBags.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const tests = this.ctx.get<HandlerTestBase[]>("testRunner.tests") ?? [];
    if (!Array.isArray(tests)) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_tests_invalid",
        detail:
          "ctx['testRunner.tests'] is not an array. Ops: ensure tests are loaded before executePlan.",
        stage: "testRunner.tests.invalid",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "test-runner.code.executePlan: ctx['testRunner.tests'] invalid.",
        logLevel: "error",
      });
      return;
    }

    const envLabel = (this.controller as any)?.getSvcEnv?.()?.env ?? "";
    let dbState = "";
    try {
      dbState = this.getVar("DB_STATE", false) || "";
    } catch {
      dbState = "";
    }

    const serviceSlug = "test-runner";
    const serviceVersion = 1;
    const runId = crypto.randomUUID();

    const nowIso = new Date().toISOString();
    const runDto = new TestRunDto({ createdAt: nowIso, updatedAt: nowIso });

    runDto.runId = runId;
    runDto.env = envLabel; // IMPORTANT: prevent TestRunDto validation failures downstream
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
    runDto.status = "error"; // pessimistic until finalized

    const startedAtMs = Date.now();
    runDto.startedAt = new Date(startedAtMs).toISOString();

    const handlerDtos: TestHandlerDto[] = [];

    let handlerCount = 0;
    let passed = 0;
    let failed = 0;

    const failedList: Array<{ testId: string; name: string }> = [];

    for (const test of tests) {
      if (!test || typeof test.run !== "function") {
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

      const status = result.dto.status as TestHandlerStatus;
      if (status === "pass") {
        passed += 1;
      } else {
        failed += 1;
        failedList.push({ testId: result.raw.testId, name: result.raw.name });
      }
    }

    const finishedAtMs = Date.now();
    runDto.finishedAt = new Date(finishedAtMs).toISOString();
    runDto.durationMs = Math.max(0, finishedAtMs - startedAtMs);

    runDto.handlerCount = handlerCount;
    runDto.passedHandlerCount = passed;
    runDto.failedHandlerCount = failed;
    runDto.errorHandlerCount = 0;

    let finalStatus: TestRunStatus = "pass";
    if (failed > 0) finalStatus = "fail";
    runDto.status = finalStatus;

    const runBag = new DtoBag<TestRunDto>([runDto]);
    const handlerBag = new DtoBag<TestHandlerDto>(handlerDtos);

    this.ctx.set("testRunner.runId", runId);
    this.ctx.set("testRunner.runBag", runBag);
    this.ctx.set("testRunner.handlerBag", handlerBag);

    // LEAN RESPONSE: return only this invocation’s run record (singleton)
    this.ctx.set("bag", runBag);

    this.log.info(
      {
        event: "test_runner_execute_plan_counts",
        requestId,
        runId,
        status: runDto.status,
        handlerCount,
        passedHandlerCount: passed,
        failedHandlerCount: failed,
      },
      "test-runner.code.executePlan: test execution counts."
    );

    if (failedList.length > 0) {
      this.log.warn(
        {
          event: "test_runner_failed_tests",
          requestId,
          runId,
          failedTests: failedList,
        },
        "test-runner.code.executePlan: failed tests."
      );
    }

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

    dto.handlerName = raw.name;
    dto.handlerPath = "(inline-test)";
    dto.dtoType = "(n/a)";
    dto.scenarioName = raw.testId;

    dto.requestId = meta.requestId;
    dto.startedAt = new Date(startedAt).toISOString();

    dto.status = raw.outcome === "passed" ? "pass" : "fail";
    dto.assertionCount = raw.assertionCount;
    dto.failedAssertions = raw.failedAssertions;
    dto.durationMs = Math.max(0, raw.durationMs);

    dto.finishedAt = new Date(startedAt + dto.durationMs).toISOString();

    return { dto, raw };
  }
}
