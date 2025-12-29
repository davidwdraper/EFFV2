// backend/services/test-runner/src/svc/StepIterator.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - LDD-38 (Test Runner vNext Design)
 * - LDD-39 (StepIterator Micro-Contract — Revised, KISS)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - StepIterator: iterate resolved handler steps for a single pipeline.
 *
 * Responsibilities (100,000 ft, per LDD-39 + HandlerTestDto + ScenarioRunner):
 * - For each handler step:
 *   1) Mint and seed a fresh HandlerTestDto (no leaks between steps).
 *   2) Immediately persist a "started" HandlerTestRecord via TestRunWriter.
 *   3) Delegate scenario execution to ScenarioRunner (test-module orchestration).
 *   4) Derive final test status from HandlerTestDto.finalizeFromScenarios()
 *      and finalize the HandlerTestRecord via TestRunWriter.
 *
 * SOP (no backwards compat):
 * - ScenarioRunner requires ScenarioDeps.
 * - Sidecars MUST accept deps in getScenarios(deps) and run(deps).
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerContext as HandlerContextCtor } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { HandlerTestDtoRegistry } from "@nv/shared/dto/registry/handler-test.dtoRegistry";
import { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";

import type {
  TestHandlerTerminalStatus,
  HandlerTestRecord,
  TestRunWriter,
} from "./TestRunWriter";

import { ScenarioRunner, type HandlerTestModuleLoader } from "./ScenarioRunner";

type LoggerLike = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

export class StepIterator {
  private readonly handlerTestRegistry = new HandlerTestDtoRegistry();
  private readonly moduleLoader: HandlerTestModuleLoader;

  public constructor(loader: HandlerTestModuleLoader) {
    this.moduleLoader = loader;
  }

  public async execute(input: {
    ctx: HandlerContext;
    controller: ControllerBase;
    steps: HandlerBase[];
    indexRelativePath: string;
    testRunId: string;
    writer: TestRunWriter;
    target?: {
      serviceSlug: string;
      serviceVersion: number;
    };
    app?: AppBase;
  }): Promise<void> {
    const { ctx, steps, indexRelativePath, testRunId, writer, target } = input;

    const log = ctx.get<LoggerLike>("log");

    if (!target) {
      const msg =
        "StepIterator.execute: missing target metadata (serviceSlug/serviceVersion).";
      log?.error?.(
        {
          event: "stepIterator_missing_target",
          index: indexRelativePath,
          stepCount: steps.length,
          testRunId,
        },
        msg
      );
      throw new Error(msg);
    }

    // ScenarioRunner is created per execute() so it can use this ctx's logger.
    const scenarioRunner = new ScenarioRunner({
      loader: this.moduleLoader,
      logger: log
        ? {
            debug: (msg, meta) =>
              log.info?.({ event: "debug", ...(meta || {}) }, msg),
            info: (msg, meta) => log.info?.(meta || {}, msg),
            warn: (msg, meta) => log.warn?.(meta || {}, msg),
            error: (msg, meta) => log.error?.(meta || {}, msg),
          }
        : undefined,
    });

    // AppBase is not used by most tests today, but it’s part of deps.
    const app = input.app as AppBase;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      const handlerName =
        typeof (step as any).getHandlerName === "function"
          ? (step as any).getHandlerName()
          : step.constructor.name;

      log?.info?.(
        {
          event: "step_inspected",
          index: indexRelativePath,
          stepIndex: i,
          stepCount: steps.length,
          handler: handlerName,
        },
        "Pipeline step inspected"
      );

      const handlerTestDto: HandlerTestDto =
        this.handlerTestRegistry.newHandlerTestDto();

      handlerTestDto.ensureId();

      handlerTestDto.setIndexRelativePathOnce(indexRelativePath);
      handlerTestDto.setHandlerNameOnce(handlerName);
      handlerTestDto.setTargetServiceSlugOnce(target.serviceSlug);
      handlerTestDto.setTargetServiceVersionOnce(target.serviceVersion);

      handlerTestDto.markStarted();

      const record: HandlerTestRecord = {
        dto: handlerTestDto,
        testRunId,
        stepIndex: i,
        stepCount: steps.length,
        indexRelativePath,
        handlerName,
        targetServiceSlug: target.serviceSlug,
        targetServiceVersion: target.serviceVersion,
        rawResult: null,
      };

      try {
        await writer.startHandlerTest(record);
      } catch (err) {
        const msgErr =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        log?.error?.(
          {
            event: "testHandler_start_failed",
            index: indexRelativePath,
            stepIndex: i,
            handler: handlerName,
            error: msgErr,
          },
          "Failed to start handler-test record; skipping scenario execution"
        );
        continue;
      }

      // Build deps ONCE per handler step. Scenarios get fresh ctx via makeScenarioCtx().
      const deps = {
        step,
        controller: input.controller,
        app,
        pipelineCtx: ctx,
        makeScenarioCtx: (seed: {
          requestId: string;
          dtoType?: string;
          op?: string;
        }) => {
          const sc = new HandlerContextCtor();

          sc.set("requestId", seed.requestId);
          sc.set("status", 200);
          sc.set("handlerStatus", "ok");

          if (seed.dtoType) sc.set("dtoType", seed.dtoType);
          if (seed.op) sc.set("op", seed.op);

          // Carry pipeline visibility keys (diagnostics only).
          try {
            sc.set("pipeline", ctx.get("pipeline"));
          } catch {
            // ignore
          }
          try {
            sc.set(
              "testRunner.index.absolutePath",
              ctx.get("testRunner.index.absolutePath")
            );
          } catch {
            // ignore
          }
          try {
            sc.set(
              "testRunner.index.relativePath",
              ctx.get("testRunner.index.relativePath")
            );
          } catch {
            // ignore
          }

          // Reuse the same logger instance if present.
          try {
            sc.set("log", ctx.get("log"));
          } catch {
            // ignore
          }

          return sc;
        },
        target,
      };

      try {
        await scenarioRunner.run(handlerTestDto, deps);
      } catch (err) {
        const msgErr =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        log?.error?.(
          {
            event: "scenarioRunner_run_threw",
            index: indexRelativePath,
            stepIndex: i,
            stepCount: steps.length,
            handler: handlerName,
            error: msgErr,
          },
          "ScenarioRunner.run threw unexpectedly"
        );

        handlerTestDto.markTestError();
      }

      const finishedAtIso = new Date().toISOString();
      handlerTestDto.setFinishedAt(finishedAtIso);

      try {
        handlerTestDto.finalizeFromScenarios();
      } catch (err) {
        const msgErr =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        log?.error?.(
          {
            event: "handlerTest_finalizeFromScenarios_threw",
            index: indexRelativePath,
            stepIndex: i,
            stepCount: steps.length,
            handler: handlerName,
            error: msgErr,
          },
          "HandlerTestDto.finalizeFromScenarios threw"
        );

        handlerTestDto.markTestError();
      }

      const dtoStatus = handlerTestDto.getStatus();
      let terminalStatus: TestHandlerTerminalStatus;

      switch (dtoStatus) {
        case "Passed":
          terminalStatus = "Passed";
          break;
        case "Failed":
          terminalStatus = "Failed";
          break;
        case "Skipped":
          terminalStatus = "Skipped";
          break;
        case "Started":
        case "TestError":
        default:
          terminalStatus = "TestError";
          break;
      }

      const scenarios = handlerTestDto.getScenarios();
      let errMsg: string | undefined;
      let errStack: string | undefined;

      if (scenarios.length) {
        const bad = scenarios.find((s) => s.status === "Failed");
        if (bad) {
          errMsg = bad.errorMessage;
          errStack = bad.errorStack;
        }
      }

      record.terminalStatus = terminalStatus;
      record.errorMessage = errMsg;
      record.errorStack = errStack;

      try {
        await writer.finalizeHandlerTest(record);
      } catch (err) {
        const msgErr =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        log?.error?.(
          {
            event: "testHandler_finalize_failed",
            index: indexRelativePath,
            stepIndex: i,
            handler: handlerName,
            error: msgErr,
            intendedStatus: terminalStatus,
          },
          "Failed to finalize handler-test record"
        );
        continue;
      }
    }
  }
}
