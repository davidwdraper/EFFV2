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
 * Option A Semantics:
 * - TestHandlerDto.serviceSlug/serviceVersion/controllerName/pipelineLabel/pipelinePath describe the TARGET under test.
 * - runner* fields describe THIS test-runner invocation.
 */

import crypto from "crypto";
import * as path from "path";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { DtoBag } from "@nv/shared/dto/DtoBag";
import { TestRunDto, type TestRunStatus } from "@nv/shared/dto/test-run.dto";
import { TestHandlerDto } from "@nv/shared/dto/test-handler.dto";

import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { TestRunnerLoadedHandler } from "./code.loadTests";

type TargetMeta = {
  // TARGET (under test)
  serviceSlug: string;
  serviceVersion: number;
  controllerName: string;
  pipelineLabel: string;
  pipelinePath: string;

  // Helpful display/debug
  handlerPath: string;
};

export class CodeExecutePlanHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Execute handler-level tests by calling handler.runTest() and project results into TestRunDto/TestHandlerDto DtoBags.";
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

    const envLabel = (this.controller as any)?.getSvcEnv?.()?.env ?? "";
    let dbState = "";
    try {
      dbState = this.getVar("DB_STATE", false) || "";
    } catch {
      dbState = "";
    }

    // Runner identity (this service)
    const runnerServiceSlug = "test-runner";
    const runnerServiceVersion = 1;
    const runnerControllerName = "run.controller";
    const runnerPipelineLabel = "run.handlerPipeline";
    const runnerPipelinePath =
      "controllers/run.controller/pipelines/run.handlerPipeline";

    const runId = crypto.randomUUID();

    const nowIso = new Date().toISOString();
    const runDto = new TestRunDto({ createdAt: nowIso, updatedAt: nowIso });

    runDto.runId = runId;
    runDto.env = envLabel;
    runDto.dbState = dbState;

    // NOTE: TestRunDto is still “about the run”, which is owned by test-runner.
    runDto.serviceSlug = runnerServiceSlug;
    runDto.serviceVersion = runnerServiceVersion;
    runDto.controllerName = runnerControllerName;
    runDto.controllerPath = runnerPipelinePath;
    runDto.pipelineLabel = runnerPipelineLabel;
    runDto.pipelinePath = runnerPipelinePath;

    runDto.requestId = requestId;
    runDto.status = "error";

    const startedAtMs = Date.now();
    runDto.startedAt = new Date(startedAtMs).toISOString();

    const handlerDtos: TestHandlerDto[] = [];

    let handlerCount = 0;
    let passed = 0;
    let failed = 0;

    const failedList: Array<{ testId: string; handlerName: string }> = [];

    for (const item of loaded) {
      const handler = item?.handler;
      if (!handler || typeof (handler as any).runTest !== "function") {
        continue;
      }

      let raw: HandlerTestResult | undefined;

      try {
        raw = await (handler as any).runTest();
      } catch (err) {
        // Contract says runTest() should not throw. If it does, treat it as a failure.
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");
        raw = {
          testId: "handler.runTest:threw",
          name: this.safeHandlerName(handler),
          outcome: "failed",
          assertionCount: 0,
          failedAssertions: [msg],
          errorMessage: msg,
          durationMs: 0,
        };
      }

      // KISS: undefined means "no test" → skip entirely.
      if (!raw) continue;

      const target = this.deriveTargetMeta(item);

      const dto = this.toTestHandlerDto(raw, {
        runId,
        envLabel,
        dbState,
        requestId,

        // TARGET (under test)
        target,

        // RUNNER
        runner: {
          runnerServiceSlug,
          runnerServiceVersion,
          runnerControllerName,
          runnerPipelineLabel,
          runnerPipelinePath,
        },

        // identity
        handlerName: this.safeHandlerName(handler),
      });

      handlerDtos.push(dto);
      handlerCount += 1;

      if (dto.status === "pass") {
        passed += 1;
      } else {
        failed += 1;
        failedList.push({ testId: raw.testId, handlerName: dto.handlerName });
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

    // Only create handlerBag if at least 1 handler result exists.
    const handlerBag =
      handlerDtos.length > 0 ? new DtoBag<TestHandlerDto>(handlerDtos) : null;

    this.ctx.set("testRunner.runId", runId);
    this.ctx.set("testRunner.runBag", runBag);

    if (handlerBag) {
      this.ctx.set("testRunner.handlerBag", handlerBag);
    } else {
      // Safety: ensure downstream can't "accidentally" try to log empty handlers.
      this.ctx.set("testRunner.handlerBag", undefined as any);
    }

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

    // Prefer absolute path when present.
    const p = abs || rel;

    // Example:
    // /.../backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/index.ts
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

    // Keep it honest: if parsing fails, set minimal placeholders but DO NOT crash the run.
    // Validation happens later at write-time; you’ll see it immediately.
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

      // TARGET
      target: TargetMeta;

      // RUNNER
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

    // TARGET under test
    dto.serviceSlug = meta.target.serviceSlug;
    dto.serviceVersion = meta.target.serviceVersion;
    dto.controllerName = meta.target.controllerName;
    dto.pipelineLabel = meta.target.pipelineLabel;
    dto.pipelinePath = meta.target.pipelinePath;
    dto.handlerName = meta.handlerName;
    dto.handlerPath = meta.target.handlerPath;

    // Runner stamp
    dto.runnerServiceSlug = meta.runner.runnerServiceSlug;
    dto.runnerServiceVersion = meta.runner.runnerServiceVersion;
    dto.runnerControllerName = meta.runner.runnerControllerName;
    dto.runnerPipelineLabel = meta.runner.runnerPipelineLabel;
    dto.runnerPipelinePath = meta.runner.runnerPipelinePath;

    // The test result describes the scenario.
    dto.dtoType = "(n/a)";
    dto.scenarioName = raw.testId;

    dto.requestId = meta.requestId;
    dto.startedAt = new Date(startedAt).toISOString();

    dto.status = raw.outcome === "passed" ? "pass" : "fail";
    dto.assertionCount = raw.assertionCount;
    dto.failedAssertions = raw.failedAssertions;
    dto.durationMs = Math.max(0, raw.durationMs);

    dto.finishedAt = new Date(startedAt + dto.durationMs).toISOString();

    return dto;
  }
}
