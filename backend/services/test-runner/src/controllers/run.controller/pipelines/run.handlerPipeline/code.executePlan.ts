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
 *
 * Semantics:
 * - Invocation-level TestRunDto is seeded earlier by code.seedRun and stored at:
 *   - ctx["testRunner.runId"]
 *   - ctx["testRunner.runBag"]
 * - This handler MUST NOT mint a new runId/runBag.
 *
 * Option A Semantics:
 * - TestHandlerDto.serviceSlug/serviceVersion/controllerName/pipelineLabel/pipelinePath describe the TARGET under test.
 * - runner* fields describe THIS test-runner invocation.
 *
 * Invariant:
 * - Every HandlerTestResult returned by handler.runTest() MUST be counted.
 */

import * as path from "path";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { TestRunDto, type TestRunStatus } from "@nv/shared/dto/test-run.dto";
import { TestHandlerDto } from "@nv/shared/dto/test-handler.dto";

import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { TestRunnerLoadedHandler } from "./code.loadTests";

type TargetMeta = {
  serviceSlug: string;
  serviceVersion: number;
  controllerName: string;
  pipelineLabel: string;
  pipelinePath: string;
  handlerPath: string;
};

export class CodeExecutePlanHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Execute handler-level tests by calling handler.runTest() and project results into TestRunDto/TestHandlerDto DtoBags.";
  }

  protected handlerName(): string {
    return "code.executePlan";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const loaded = (this.ctx.get<TestRunnerLoadedHandler[]>(
      "testRunner.handlers"
    ) ?? []) as TestRunnerLoadedHandler[] | [];

    if (!Array.isArray(loaded)) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_handlers_invalid",
        detail:
          "ctx['testRunner.handlers'] is not an array. Ops: ensure code.loadTests runs before code.executePlan.",
        stage: "testRunner.handlers.invalid",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "test-runner.code.executePlan: ctx['testRunner.handlers'] invalid.",
        logLevel: "error",
      });
      return;
    }

    const runId = this.ctx.get<string>("testRunner.runId") ?? "";
    const runBag =
      (this.ctx.get<DtoBag<TestRunDto>>("testRunner.runBag") as
        | DtoBag<TestRunDto>
        | undefined) ?? null;

    if (!runId || !runBag) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_run_seed_missing",
        detail:
          "Missing ctx['testRunner.runId'] or ctx['testRunner.runBag']. Ops: ensure code.seedRun runs before code.executePlan.",
        stage: "testRunner.runSeed.missing",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "test-runner.code.executePlan: missing seeded runId/runBag.",
        logLevel: "error",
      });
      return;
    }

    const runItems: TestRunDto[] = [];
    try {
      for (const dto of runBag.items()) runItems.push(dto);
    } catch {
      // ignore
    }

    const runDto = runItems.length === 1 ? runItems[0] : null;

    if (!runDto) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_run_bag_invalid",
        detail:
          "ctx['testRunner.runBag'] must be a singleton bag containing exactly 1 TestRunDto. Ops: verify code.seedRun invariants.",
        stage: "testRunner.runBag.invalid",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "test-runner.code.executePlan: seeded runBag is not a singleton.",
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

    const runnerServiceSlug = "test-runner";
    const runnerServiceVersion = 1;
    const runnerControllerName = "run.controller";
    const runnerPipelineLabel = "run.handlerPipeline";
    const runnerPipelinePath =
      "controllers/run.controller/pipelines/run.handlerPipeline";

    const startedAtMs = runDto.startedAt ? Date.parse(runDto.startedAt) : NaN;
    const effectiveStartedAtMs = Number.isFinite(startedAtMs)
      ? startedAtMs
      : Date.now();

    if (!runDto.startedAt) {
      runDto.startedAt = new Date(effectiveStartedAtMs).toISOString();
    }

    if (!runDto.env) runDto.env = envLabel;
    if (!runDto.dbState) runDto.dbState = dbState;

    const handlerDtos: TestHandlerDto[] = [];

    let handlerCount = 0;
    let passed = 0;
    let failed = 0;

    const failedList: Array<{ testId: string; handlerName: string }> = [];

    // New: global FAIL-FAST. Once any test fails, stop executing further tests.
    let stop = false;

    for (const item of loaded) {
      if (stop) break;

      const handler = item?.handler;
      if (!handler || typeof (handler as any).runTest !== "function") {
        continue;
      }

      let raw: HandlerTestResult | HandlerTestResult[] | undefined;

      try {
        raw = await (handler as any).runTest();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");
        raw = {
          testId: "handler.runTest:threw",
          name: this.safeHandlerName(handler),
          outcome: "failed",
          expectedError: false,
          assertionCount: 0,
          failedAssertions: [msg],
          errorMessage: msg,
          durationMs: 0,
        };
      }

      if (!raw) continue;

      const raws: HandlerTestResult[] = Array.isArray(raw) ? raw : [raw];
      if (raws.length === 0) continue;

      const target = this.deriveTargetMeta(item);

      for (const r of raws) {
        if (stop) break;

        const dto = this.toTestHandlerDto(r, {
          runId,
          envLabel,
          dbState,
          requestId,
          target,
          runner: {
            runnerServiceSlug,
            runnerServiceVersion,
            runnerControllerName,
            runnerPipelineLabel,
            runnerPipelinePath,
          },
          handlerName: this.safeHandlerName(handler),
        });

        handlerDtos.push(dto);
        handlerCount += 1;

        if (dto.status === "pass") {
          passed += 1;
        } else {
          failed += 1;
          failedList.push({ testId: r.testId, handlerName: dto.handlerName });
          stop = true; // FAIL-FAST: stop after first failure
        }
      }
    }

    const finishedAtMs = Date.now();
    runDto.finishedAt = new Date(finishedAtMs).toISOString();
    runDto.durationMs = Math.max(0, finishedAtMs - effectiveStartedAtMs);

    runDto.handlerCount = handlerCount;
    runDto.passedHandlerCount = passed;
    runDto.failedHandlerCount = failed;
    runDto.errorHandlerCount = 0;

    let finalStatus: TestRunStatus = "pass";
    if (failed > 0) finalStatus = "fail";
    runDto.status = finalStatus;

    const handlerBag =
      handlerDtos.length > 0
        ? new (runBag.constructor as any)(handlerDtos)
        : null;

    this.ctx.set("testRunner.runId", runId);
    this.ctx.set("testRunner.runBag", runBag);

    if (handlerBag) {
      this.ctx.set("testRunner.handlerBag", handlerBag);
    } else {
      this.ctx.set("testRunner.handlerBag", undefined as any);
    }

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
        failFast: true,
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
          failFast: true,
        },
        "test-runner.code.executePlan: failed tests."
      );
    }

    this.ctx.set("handlerStatus", "ok");
  }

  private safeHandlerName(handler: unknown): string {
    try {
      const anyH = handler as any;
      if (typeof anyH.handlerName === "function") {
        const n = anyH.handlerName();
        if (typeof n === "string" && n.trim() !== "") return n.trim();
      }
    } catch {
      // ignore
    }

    try {
      const ctor = (handler as any)?.constructor?.name;
      if (typeof ctor === "string" && ctor.trim() !== "") return ctor.trim();
    } catch {
      // ignore
    }

    return "(unknown-handler)";
  }

  private deriveTargetMeta(item: TestRunnerLoadedHandler): TargetMeta {
    const abs = String(item?.pipeline?.absolutePath ?? "").trim();
    const rel = String(item?.pipeline?.relativePath ?? abs).trim();
    const p = abs || rel;
    const norm = p.split(path.sep).join("/");

    const serviceSlug =
      this.extractBetween(norm, "/backend/services/", "/src/") ?? "";
    const controllerName =
      this.extractBetween(norm, "/src/controllers/", "/pipelines/") ?? "";
    const pipelineLabel =
      this.extractBetween(norm, "/pipelines/", "/index.ts") ?? "";

    const pipelinePath =
      controllerName && pipelineLabel
        ? `controllers/${controllerName}/pipelines/${pipelineLabel}`
        : "";

    const safeServiceSlug = serviceSlug || "(unknown-service)";
    const safeControllerName = controllerName || "(unknown-controller)";
    const safePipelineLabel = pipelineLabel || "(unknown-pipeline)";
    const safePipelinePath = pipelinePath || "(unknown-pipeline-path)";

    return {
      serviceSlug: safeServiceSlug,
      serviceVersion: 1,
      controllerName: safeControllerName,
      pipelineLabel: safePipelineLabel,
      pipelinePath: safePipelinePath,
      handlerPath: p || "(unknown-pipeline-index)",
    };
  }

  private extractBetween(
    s: string,
    left: string,
    right: string
  ): string | null {
    const i = s.indexOf(left);
    if (i < 0) return null;
    const j = s.indexOf(right, i + left.length);
    if (j < 0) return null;
    const out = s.slice(i + left.length, j);
    return out.trim() ? out.trim() : null;
  }

  private toTestHandlerDto(
    raw: HandlerTestResult,
    meta: {
      runId: string;
      envLabel: string;
      dbState: string;
      requestId: string;
      target: TargetMeta;
      runner: {
        runnerServiceSlug: string;
        runnerServiceVersion: number;
        runnerControllerName: string;
        runnerPipelineLabel: string;
        runnerPipelinePath: string;
      };
      handlerName: string;
    }
  ): TestHandlerDto {
    const startedAt = Date.now();

    const dto = new TestHandlerDto({
      createdAt: new Date(startedAt).toISOString(),
      updatedAt: new Date(startedAt).toISOString(),
    });

    dto.runId = meta.runId;
    dto.env = meta.envLabel;
    dto.dbState = meta.dbState;

    dto.serviceSlug = meta.target.serviceSlug;
    dto.serviceVersion = meta.target.serviceVersion;
    dto.controllerName = meta.target.controllerName;
    dto.pipelineLabel = meta.target.pipelineLabel;
    dto.pipelinePath = meta.target.pipelinePath;
    dto.handlerName = meta.handlerName;
    dto.handlerPath = meta.target.handlerPath;

    dto.runnerServiceSlug = meta.runner.runnerServiceSlug;
    dto.runnerServiceVersion = meta.runner.runnerServiceVersion;
    dto.runnerControllerName = meta.runner.runnerControllerName;
    dto.runnerPipelineLabel = meta.runner.runnerPipelineLabel;
    dto.runnerPipelinePath = meta.runner.runnerPipelinePath;

    dto.dtoType = "(n/a)";
    dto.scenarioName = raw.testId;

    dto.requestId = meta.requestId;
    dto.startedAt = new Date(startedAt).toISOString();

    // Still KISS: outcome drives pass/fail; harness now guarantees rails verdict.
    dto.status = raw.outcome === "passed" ? "pass" : "fail";
    dto.assertionCount = raw.assertionCount;
    dto.failedAssertions = raw.failedAssertions;
    dto.durationMs = Math.max(0, raw.durationMs);

    dto.finishedAt = new Date(startedAt + dto.durationMs).toISOString();

    return dto;
  }
}
