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
 * Key invariant:
 * - Scenario ctx is fresh per scenario.
 * - Handler execution is production-shaped:
 *     new Handler(scenarioCtx, controller).run()
 *   NOT “reuse handler instance” and NOT “call protected execute()”.
 *
 * Virtual-server invariant:
 * - Scenario ctx MUST inherit pipeline runtime ("rt") automatically.
 * - Tests must not be SvcRuntime-aware.
 *
 * Rails:
 * - Handler execution MUST run inside requestScope ALS so:
 *   - expected-negative errors can be downgraded (no pager-noise)
 *   - SvcClient can propagate x-nv-test-* headers across S2S hops
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerContext as HandlerContextCtor } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { withRequestScope } from "@nv/shared/http/requestScope";

import { HandlerTestDtoRegistry } from "@nv/shared/dto/registry/handler-test.dtoRegistry";
import { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";

import type {
  TestHandlerTerminalStatus,
  HandlerTestRecord,
  TestRunWriter,
} from "./TestRunWriter";

import {
  ScenarioRunner,
  type HandlerTestModuleLoader,
  type ScenarioStep,
} from "./ScenarioRunner";

type LoggerLike = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

function normalizeScenarios(dto: HandlerTestDto): any[] {
  try {
    const v = (dto as any)?.getScenarios?.();
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

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
          stepCount: Array.isArray(steps) ? steps.length : "(not-array)",
          testRunId,
        },
        msg
      );
      throw new Error(msg);
    }

    // Fail-fast: StepIterator contract requires a resolved array of handler steps.
    // This is a pipeline export/loader problem, not “0 steps”.
    if (!Array.isArray(steps)) {
      const msg = [
        "StepIterator.execute: pipeline steps are not an array.",
        `Index: ${indexRelativePath}`,
        `Target: ${target.serviceSlug}@${target.serviceVersion}`,
        `Typeof(steps): ${typeof steps}`,
        "Ops: fix IndexLoader / pipeline index export shape so resolved.steps is a HandlerBase[] array.",
      ].join(" ");

      log?.error?.(
        {
          event: "stepIterator_steps_not_array",
          index: indexRelativePath,
          targetServiceSlug: target.serviceSlug,
          targetServiceVersion: target.serviceVersion,
          stepsType: typeof steps,
          hasSteps: !!steps,
          testRunId,
        },
        msg
      );

      throw new Error(msg);
    }

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

    const app = input.app as AppBase;

    for (let i = 0; i < steps.length; i++) {
      const stepInstance = steps[i];

      const handlerName =
        typeof (stepInstance as any).getHandlerName === "function"
          ? (stepInstance as any).getHandlerName()
          : stepInstance.constructor.name;

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

      // Build a production-shaped step executor.
      const handlerCtor = (stepInstance as any).constructor as new (
        c: HandlerContext,
        controller: ControllerBase
      ) => HandlerBase;

      const step: ScenarioStep = {
        handlerName,
        execute: async (scenarioCtx: HandlerContext) => {
          if (!scenarioCtx) {
            throw new Error(
              `StepIterator: scenarioCtx is required for handler="${handlerName}"`
            );
          }

          const requestId =
            scenarioCtx.get<string>("requestId") ?? `scenario-${Date.now()}`;

          const expectErrors =
            scenarioCtx.get<boolean | undefined>("test.expectErrors") === true;

          // Rails: run handler execution inside ALS requestScope so shared error helpers
          // can downgrade expected-negative logs and SvcClient can propagate x-nv-test-*.
          await withRequestScope(
            {
              requestId,
              testRunId,
              expectErrors,
            },
            async () => {
              const h = new handlerCtor(scenarioCtx, input.controller);
              await h.run();
            }
          );
        },
      };

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

          // Inherit pipeline metadata for visibility.
          try {
            sc.set("pipeline", ctx.get("pipeline"));
          } catch {}
          try {
            sc.set(
              "testRunner.index.absolutePath",
              ctx.get("testRunner.index.absolutePath")
            );
          } catch {}
          try {
            sc.set(
              "testRunner.index.relativePath",
              ctx.get("testRunner.index.relativePath")
            );
          } catch {}
          try {
            sc.set("log", ctx.get("log"));
          } catch {}

          // Virtual-server invariant: inherit runtime ("rt") automatically.
          // Tests must not seed rt; the rails do it.
          try {
            sc.set("rt", ctx.get("rt"));
          } catch {}

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

      handlerTestDto.setFinishedAt(new Date().toISOString());

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

      // IMPORTANT: getScenarios() may be undefined in some failure paths.
      const scenarios = normalizeScenarios(handlerTestDto);

      let errMsg: string | undefined;
      let errStack: string | undefined;

      if (scenarios.length) {
        const bad = scenarios.find((s) => s?.status === "Failed");
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
