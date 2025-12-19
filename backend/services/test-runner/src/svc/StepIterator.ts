// backend/services/test-runner/src/svc/StepIterator.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - LDD-38 (Test Runner vNext Design)
 * - LDD-39 (StepIterator Micro-Contract — Revised, KISS)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - StepIterator: iterate resolved handler steps for a single pipeline.
 *
 * Responsibilities (per LDD-39 + HandlerTestDto):
 * - hasTest() gate (opt-in only)
 * - For opted-in handlers:
 *     • mint a HandlerTestDto as the canonical record
 *     • mint a HandlerTestRecord wrapper with run metadata
 *     • writer.startHandlerTest(record) immediately
 *     • expose the dto on ctx["handlerTest.dto"]
 *     • execute handler.runTest() inside dto.runScenario(...)
 *     • classify the outcome:
 *         - Passed / Failed (from returned payload)
 *         - TestError (runTest() returned undefined or no scenarios)
 *         - RailError (runTest() threw — captured by runScenario)
 *     • set finishedAt and finalize dto from scenarios
 *     • populate terminalStatus/error info on the record (not the DTO)
 *     • writer.finalizeHandlerTest(record)
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

import { HandlerTestDtoRegistry } from "@nv/shared/dto/registry/handler-test.dtoRegistry";
import type { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";

import type {
  TestHandlerTerminalStatus,
  HandlerTestRecord,
  TestRunWriter,
} from "./TestRunWriter";

type LoggerLike = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

export class StepIterator {
  /**
   * Shared registry for minting HandlerTestDto instances.
   */
  private readonly handlerTestRegistry = new HandlerTestDtoRegistry();

  public constructor() {}

  public async execute(input: {
    ctx: HandlerContext;
    controller: ControllerBase;
    steps: HandlerBase[];
    indexRelativePath: string;
    testRunId: string;
    writer: TestRunWriter;
    target: {
      serviceSlug: string;
      serviceVersion: number;
    };
  }): Promise<void> {
    const { ctx, steps, indexRelativePath, testRunId, writer, target } = input;

    const log = ctx.get<LoggerLike>("log");

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      const handlerName =
        typeof step.getHandlerName === "function"
          ? step.getHandlerName()
          : step.constructor.name;

      let hasTest = false;

      // 1) hasTest() gate
      try {
        hasTest = step.hasTest();
      } catch (err) {
        // hasTest() throwing means rails are broken; treat as opted-in and record.
        hasTest = true;

        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        if (log?.error) {
          log.error(
            {
              event: "step_hasTest_threw",
              index: indexRelativePath,
              stepIndex: i,
              stepCount: steps.length,
              handler: handlerName,
              error: msg,
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

      // 2) Opted-in => mint a HandlerTestDto and HandlerTestRecord
      const startedAtMs = Date.now();
      const handlerTestDto: HandlerTestDto =
        this.handlerTestRegistry.newHandlerTestDto();

      handlerTestDto.setIndexRelativePathOnce(indexRelativePath);
      handlerTestDto.setHandlerNameOnce(handlerName);
      handlerTestDto.setTargetServiceSlugOnce(target.serviceSlug);
      handlerTestDto.setTargetServiceVersionOnce(target.serviceVersion);

      const startedAtIso = new Date(startedAtMs).toISOString();
      handlerTestDto.setStartedAt(startedAtIso);

      const record: HandlerTestRecord = {
        dto: handlerTestDto,
        testRunId,
        stepIndex: i,
        stepCount: steps.length,
        indexRelativePath,
        handlerName,
        targetServiceSlug: target.serviceSlug,
        targetServiceVersion: target.serviceVersion,
      };

      // Expose the DTO on the HandlerContext so handler-owned tests can see it.
      ctx.set("handlerTest.dto", handlerTestDto);

      // 3) Start: immediately persist the new record via the writer.
      try {
        await writer.startHandlerTest(record);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        if (log?.error) {
          log.error(
            {
              event: "testHandler_start_failed",
              index: indexRelativePath,
              stepIndex: i,
              handler: handlerName,
              error: msg,
            },
            "Failed to start handler-test record; skipping test execution"
          );
        }

        continue;
      }

      // 4) Execute runTest() inside dto.runScenario(...) and classify outcome
      let terminalStatus: TestHandlerTerminalStatus = "TestError";
      let lastResult: HandlerTestResult | undefined;
      let errMsg: string | undefined;
      let errStack: string | undefined;

      try {
        await handlerTestDto.runScenario(
          handlerName,
          async () => {
            const result = await step.runTest();
            lastResult = result;

            if (!result) {
              // Absent result is a "TestError".
              return {
                status: "Failed",
                details: {
                  reason: "NO_HANDLER_TEST_RESULT",
                },
              };
            }

            return {
              status: "Passed", // always assume happy-path when a result exists
              details: result,
            };
          },
          { rethrowOnRailError: false }
        );
      } catch (err) {
        // Only unexpected exceptions in runScenario itself should hit here.
        errMsg =
          err instanceof Error ? err.message : String(err ?? "unknown error");
        errStack = err instanceof Error ? err.stack : undefined;

        if (log?.error) {
          log.error(
            {
              event: "step_runScenario_threw",
              index: indexRelativePath,
              stepIndex: i,
              stepCount: steps.length,
              handler: handlerName,
              error: errMsg,
            },
            "HandlerTestDto.runScenario threw unexpectedly"
          );
        }
      }

      const finishedAtMs = Date.now();
      const finishedAtIso = new Date(finishedAtMs).toISOString();
      handlerTestDto.setFinishedAt(finishedAtIso);

      // Derive final status/duration from scenarios (single source of truth on the DTO).
      try {
        handlerTestDto.finalizeFromScenarios();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        if (log?.error) {
          log.error(
            {
              event: "handlerTest_finalizeFromScenarios_threw",
              index: indexRelativePath,
              stepIndex: i,
              stepCount: steps.length,
              handler: handlerName,
              error: msg,
            },
            "HandlerTestDto.finalizeFromScenarios threw"
          );
        }
      }

      const dtoStatus = handlerTestDto.getStatus();

      switch (dtoStatus) {
        case "Passed":
          terminalStatus = "Passed";
          break;
        case "Failed":
          terminalStatus = "Failed";
          break;
        case "RailError":
          terminalStatus = "RailError";
          break;
        case "TestError":
        case "Started":
        default:
          terminalStatus = "TestError";
          break;
      }

      // Pull a top-level error summary from the first failing/rail scenario, if any.
      const scenarios = handlerTestDto.getScenarios();

      if (!errMsg && scenarios.length) {
        const bad = scenarios.find(
          (s) => s.status === "RailError" || s.status === "Failed"
        );
        if (bad) {
          errMsg = bad.errorMessage;
          errStack = bad.errorStack;
        }
      }

      // Populate outcome metadata on the record, not on the DTO.
      record.terminalStatus = terminalStatus;
      record.errorMessage = errMsg;
      record.errorStack = errStack;
      record.rawResult = lastResult ?? null;

      // 6) Finalize record exactly once
      try {
        await writer.finalizeHandlerTest(record);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        if (log?.error) {
          log.error(
            {
              event: "testHandler_finalize_failed",
              index: indexRelativePath,
              stepIndex: i,
              handler: handlerName,
              error: msg,
              intendedStatus: terminalStatus,
            },
            "Failed to finalize handler-test record"
          );
        }

        continue;
      }
    }
  }
}
