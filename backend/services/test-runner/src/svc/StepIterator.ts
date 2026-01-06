// backend/services/test-runner/src/svc/StepIterator.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 * - LDD-38 (Test Runner vNext Design)
 * - LDD-39 (StepIterator Micro-Contract — Revised, KISS)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - StepIterator: iterate StepDef[] for a single pipeline entry.
 *
 * ADR-0101 rule:
 * - A step is a seeder→handler pair.
 * - Test runner executes BOTH (seeder first, then handler) for the handler under test.
 *
 * ADR-0099:
 * - expectedTestName drives strict missing-test semantics.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerContext as HandlerContextCtor } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { withRequestScope } from "@nv/shared/http/requestScope";

import { HandlerTestDtoRegistry } from "@nv/shared/dto/registry/handler-test.dtoRegistry";
import { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";

import { HandlerSeeder } from "@nv/shared/http/handlers/seeding/handlerSeeder";

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

import {
  PipelineBase,
  type StepDefTest,
} from "@nv/shared/base/pipeline/PipelineBase";

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

function readScenarioOutcomeCode(s: any): number | undefined {
  const code = s?.details?.outcome?.code;
  return typeof code === "number" && Number.isFinite(code) ? code : undefined;
}

function readScenarioHttpStatus(s: any): number | undefined {
  const hs = s?.details?.rails?.httpStatus;
  return typeof hs === "number" && Number.isFinite(hs) ? hs : undefined;
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

    stepDefs: StepDefTest[];

    indexRelativePath: string;

    pipelineName?: string;

    testRunId: string;
    writer: TestRunWriter;
    target?: { serviceSlug: string; serviceVersion: number };
    app?: AppBase;
  }): Promise<void> {
    const {
      ctx,
      stepDefs,
      indexRelativePath,
      testRunId,
      writer,
      target,
      pipelineName,
    } = input;

    const log = ctx.get<LoggerLike>("log");

    if (!target) {
      const msg =
        "StepIterator.execute: missing target metadata (serviceSlug/serviceVersion).";
      log?.error?.(
        {
          event: "stepIterator_missing_target",
          index: indexRelativePath,
          stepCount: Array.isArray(stepDefs) ? stepDefs.length : "(not-array)",
          testRunId,
        },
        msg
      );
      throw new Error(msg);
    }

    if (!Array.isArray(stepDefs)) {
      throw new Error(
        `StepIterator.execute: stepDefs must be an array (index=${indexRelativePath}).`
      );
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

    let consecutiveReal500Handlers = 0;

    for (let i = 0; i < stepDefs.length; i++) {
      const stepDef = stepDefs[i];
      const handlerName = String(stepDef?.handlerName ?? "").trim();

      if (!handlerName) {
        throw new Error(
          `StepIterator.execute: blank handlerName at step index=${i} (index=${indexRelativePath}).`
        );
      }

      const expectedTestName = PipelineBase.normalizeExpectedTestName(
        (stepDef as any)?.expectedTestName
      );

      log?.info?.(
        {
          event: "step_inspected",
          index: indexRelativePath,
          stepIndex: i,
          stepCount: stepDefs.length,
          seed: String((stepDef as any)?.seedName ?? ""),
          handler: handlerName,
          expectedTestName,
        },
        "Pipeline step inspected (pair semantics)"
      );

      const handlerTestDto: HandlerTestDto =
        this.handlerTestRegistry.newHandlerTestDto();

      handlerTestDto.ensureId();

      handlerTestDto.setIndexRelativePathOnce(indexRelativePath);
      if (pipelineName) handlerTestDto.setPipelineNameOnce(pipelineName);

      handlerTestDto.setHandlerNameOnce(handlerName);
      handlerTestDto.setTargetServiceSlugOnce(target.serviceSlug);
      handlerTestDto.setTargetServiceVersionOnce(target.serviceVersion);

      handlerTestDto.markStarted();

      const record: HandlerTestRecord = {
        dto: handlerTestDto,
        testRunId,
        stepIndex: i,
        stepCount: stepDefs.length,
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

      const step: ScenarioStep = {
        handlerName,
        execute: async (scenarioCtx: HandlerContext) => {
          const requestId =
            scenarioCtx.get<string>("requestId") ?? `scenario-${Date.now()}`;

          await withRequestScope({ requestId, testRunId }, async () => {
            // 1) seed
            const SeederCtor = ((stepDef as any)?.seederCtor ??
              HandlerSeeder) as any;
            const seeder = new SeederCtor(
              scenarioCtx,
              input.controller,
              (stepDef as any)?.seedSpec
            );
            await seeder.run();

            // stop the pair if seeding failed
            if (scenarioCtx.get("handlerStatus") === "error") {
              return;
            }

            // 2) handler
            const h = new (stepDef as any).handlerCtor(
              scenarioCtx,
              input.controller,
              (stepDef as any).handlerInit
            );
            await h.run();
          });
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
          try {
            sc.set("rt", ctx.get("rt"));
          } catch {}

          return sc;
        },
        target,
        expectedTestName,
      };

      let infraAbort = false;
      let handlerEndedWithReal500 = false;

      try {
        await scenarioRunner.run(handlerTestDto, deps as any);
      } catch (err) {
        const msgErr =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        log?.error?.(
          {
            event: "scenarioRunner_run_threw",
            index: indexRelativePath,
            stepIndex: i,
            stepCount: stepDefs.length,
            handler: handlerName,
            error: msgErr,
          },
          "ScenarioRunner.run threw unexpectedly"
        );

        handlerTestDto.markTestError();
        infraAbort = true;
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
            stepCount: stepDefs.length,
            handler: handlerName,
            error: msgErr,
          },
          "HandlerTestDto.finalizeFromScenarios threw"
        );

        handlerTestDto.markTestError();
        infraAbort = true;
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

      const scenarios = normalizeScenarios(handlerTestDto);

      if (scenarios.length) {
        for (const s of scenarios) {
          const code = readScenarioOutcomeCode(s);
          if (code === 5) infraAbort = true;

          const hs = readScenarioHttpStatus(s);
          if (typeof hs === "number" && hs >= 500)
            handlerEndedWithReal500 = true;
        }
      }

      record.terminalStatus = terminalStatus;

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
        break;
      }

      if (handlerEndedWithReal500) consecutiveReal500Handlers++;
      else consecutiveReal500Handlers = 0;

      if (infraAbort) {
        log?.error?.(
          {
            event: "stepIterator_abort_infra_failure",
            index: indexRelativePath,
            stepIndex: i,
            stepCount: stepDefs.length,
            handler: handlerName,
          },
          "Aborting: infrastructure failure detected (outcomeCode=5)."
        );
        break;
      }

      if (consecutiveReal500Handlers >= 10) {
        log?.info?.(
          {
            event: "stepIterator_abort_meltdown_500s",
            index: indexRelativePath,
            stepIndex: i,
            stepCount: stepDefs.length,
            handler: handlerName,
            consecutiveReal500Handlers,
          },
          "Aborting: 10 consecutive handlers ended with real HTTP 500+ rails failures."
        );
        break;
      }
    }
  }
}
