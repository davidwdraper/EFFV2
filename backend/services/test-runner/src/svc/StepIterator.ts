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
 * - For each handler step that opts in via hasTest():
 *   1) Mint and seed a fresh HandlerTestDto (no leaks between steps).
 *   2) Immediately persist a "started" HandlerTestRecord via TestRunWriter.
 *   3) Delegate scenario execution to ScenarioRunner (test-module orchestration).
 *   4) Derive final test status from HandlerTestDto.finalizeFromScenarios()
 *      and finalize the HandlerTestRecord via TestRunWriter.
 *
 * Non-responsibilities:
 * - No per-scenario loops (ScenarioRunner owns that).
 * - No user-facing assertions or test semantics.
 * - No JSON inspection; DTO + test modules own shapes.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";

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
  type ScenarioRunnerLogger,
} from "./ScenarioRunner";

type LoggerLike = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

export class StepIterator {
  /**
   * Shared registry for minting HandlerTestDto instances.
   *
   * Invariant:
   * - This is the ONLY place in the test-runner service that mints
   *   HandlerTestDto instances. ID is minted immediately via ensureId().
   */
  private readonly handlerTestRegistry = new HandlerTestDtoRegistry();

  /**
   * Loader used by ScenarioRunner to locate per-handler test modules.
   */
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
  }): Promise<void> {
    const { ctx, steps, indexRelativePath, testRunId, writer, target } = input;

    const log = ctx.get<LoggerLike>("log");

    // Hard fail if orchestrator forgot to provide target metadata.
    if (!target) {
      const msg =
        "StepIterator.execute: missing target metadata (serviceSlug/serviceVersion).";
      if (log?.error) {
        log.error(
          {
            event: "stepIterator_missing_target",
            index: indexRelativePath,
            stepCount: steps.length,
            testRunId,
          },
          msg
        );
      }
      throw new Error(msg);
    }

    // ScenarioRunner is created per execute() so it can use this ctx's logger.
    const scenarioRunnerLogger: ScenarioRunnerLogger | undefined = log
      ? {
          debug: (msg, meta) =>
            log.info?.({ event: "debug", ...(meta || {}) }, msg),
          info: (msg, meta) => log.info?.(meta || {}, msg),
          warn: (msg, meta) => log.warn?.(meta || {}, msg),
          error: (msg, meta) => log.error?.(meta || {}, msg),
        }
      : undefined;

    const scenarioRunner = new ScenarioRunner({
      loader: this.moduleLoader,
      logger: scenarioRunnerLogger,
    });

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      const handlerName =
        typeof (step as any).getHandlerName === "function"
          ? (step as any).getHandlerName()
          : step.constructor.name;

      let hasTest = false;

      // 1) hasTest() gate (opt-in only).
      try {
        hasTest =
          typeof (step as any).hasTest === "function"
            ? (step as any).hasTest()
            : false;
      } catch (err) {
        // hasTest() throwing means rails are broken; treat as opted-in and record.
        hasTest = true;

        const msgErr =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        if (log?.error) {
          log.error(
            {
              event: "step_hasTest_threw",
              index: indexRelativePath,
              stepIndex: i,
              stepCount: steps.length,
              handler: handlerName,
              error: msgErr,
            },
            "Pipeline step hasTest() threw"
          );
        }
      }

      if (log?.info) {
        log.info(
          {
            event: "step_inspected",
            index: indexRelativePath,
            stepIndex: i,
            stepCount: steps.length,
            handler: handlerName,
            hasTest,
          },
          "Pipeline step inspected"
        );
      }

      if (!hasTest) {
        continue;
      }

      // ──────────────────────────────────────────────────────────────
      // 2) Opted-in => mint a fresh HandlerTestDto + HandlerTestRecord
      // ──────────────────────────────────────────────────────────────

      const startedAtMs = Date.now();
      const handlerTestDto: HandlerTestDto =
        this.handlerTestRegistry.newHandlerTestDto();

      // Invariant: ID MUST be minted immediately and never replaced.
      handlerTestDto.ensureId();

      // Seed required header fields (write-once).
      handlerTestDto.setIndexRelativePathOnce(indexRelativePath);
      handlerTestDto.setHandlerNameOnce(handlerName);
      handlerTestDto.setTargetServiceSlugOnce(target.serviceSlug);
      handlerTestDto.setTargetServiceVersionOnce(target.serviceVersion);

      // Mark the test as started; this stamps startedAt if not already set.
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
        // rawResult is now scenario-level; we keep this explicit for compatibility.
        rawResult: null,
      };

      // IMPORTANT: We NO LONGER expose HandlerTestDto on ctx.
      // Tests must not know about DTOs; ScenarioRunner + DTO own test recording.

      // ──────────────────────────────────────────────────────────────
      // 3) Start: immediately persist the new record via the writer.
      // ──────────────────────────────────────────────────────────────

      try {
        await writer.startHandlerTest(record);
      } catch (err) {
        const msgErr =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        if (log?.error) {
          log.error(
            {
              event: "testHandler_start_failed",
              index: indexRelativePath,
              stepIndex: i,
              handler: handlerName,
              error: msgErr,
            },
            "Failed to start handler-test record; skipping test execution"
          );
        }

        // If we can’t start the record, we do NOT run the test for this handler.
        continue;
      }

      // ──────────────────────────────────────────────────────────────
      // 4) Execute all scenarios via ScenarioRunner
      // ──────────────────────────────────────────────────────────────

      try {
        await scenarioRunner.run(handlerTestDto);
      } catch (err) {
        const msgErr =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        if (log?.error) {
          log.error(
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
        }

        // If ScenarioRunner blows up, we mark TestError; finalizeFromScenarios
        // will treat empty/partial scenarios appropriately.
        handlerTestDto.markTestError();
      }

      // Stamp finishedAt/duration and derive final TEST status from scenarios.
      const finishedAtMs = Date.now();
      const finishedAtIso = new Date(finishedAtMs).toISOString();
      handlerTestDto.setFinishedAt(finishedAtIso);

      try {
        handlerTestDto.finalizeFromScenarios();
      } catch (err) {
        const msgErr =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        if (log?.error) {
          log.error(
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
        }

        handlerTestDto.markTestError();
      }

      // Map DTO test status → terminal status for the record.
      const dtoStatus = handlerTestDto.getStatus();
      let terminalStatus: TestHandlerTerminalStatus;

      switch (dtoStatus) {
        case "Passed":
          terminalStatus = "Passed";
          break;
        case "Failed":
          terminalStatus = "Failed";
          break;
        case "Started":
        case "TestError":
        default:
          terminalStatus = "TestError";
          break;
      }

      // Pull a top-level error summary from the first failing scenario, if any.
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

      // Populate outcome metadata on the record.
      record.terminalStatus = terminalStatus;
      record.errorMessage = errMsg;
      record.errorStack = errStack;

      // ──────────────────────────────────────────────────────────────
      // 5) Finalize record exactly once
      // ──────────────────────────────────────────────────────────────

      try {
        await writer.finalizeHandlerTest(record);
      } catch (err) {
        const msgErr =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        if (log?.error) {
          log.error(
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
        }

        // Nothing more to do; failure to finalize is a rail concern, not test logic.
        continue;
      }
    }
  }
}
