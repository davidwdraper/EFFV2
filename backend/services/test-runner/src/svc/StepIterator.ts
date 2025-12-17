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
 * Responsibilities (exact; per LDD-39):
 * - hasTest() gate (opt-in only)
 * - For opted-in handlers: writer.start() immediately, then runTest(), then writer.finalize()
 * - Classify outcomes only:
 *   - Passed / Failed (from returned payload)
 *   - TestError (runTest() returned undefined)
 *   - RailError (runTest() threw)
 *
 * Non-responsibilities:
 * - No plans, no scenarios, no assertions, no test internals.
 * - No swallowing errors silently: every failure path is persisted + logged.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

import type {
  TestHandlerFinalizeInput,
  TestHandlerStartInput,
  TestHandlerTerminalStatus,
  TestRunWriter,
} from "./TestRunWriter";

export class StepIterator {
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

    const log = ctx.get<any>("log");

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      const handlerName =
        typeof (step as any).getHandlerName === "function"
          ? String((step as any).getHandlerName())
          : step.constructor.name;

      let hasTest = false;

      // 1) hasTest() gate
      try {
        hasTest =
          typeof (step as any).hasTest === "function" ? step.hasTest() : false;
      } catch (err) {
        // hasTest() throwing means rails are already broken. Treat as opted-in,
        // record, and continue after persisting a RailError.
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

      // 2) Opted-in => MUST start a handler-test record immediately
      const startedAt = Date.now();

      const startInput: TestHandlerStartInput = {
        testRunId,
        indexRelativePath,
        stepIndex: i,
        stepCount: steps.length,
        handlerName,
        targetServiceSlug: target.serviceSlug,
        targetServiceVersion: target.serviceVersion,
      };

      let testHandlerId: string;

      try {
        testHandlerId = await writer.startHandlerTest(startInput);
      } catch (err) {
        // If we can't write the start record, that's a test-runner rails failure.
        // We still do NOT execute the test, because we can't guarantee forensics.
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

      // 3) Execute runTest() and classify outcome
      let status: TestHandlerTerminalStatus;
      let result: HandlerTestResult | undefined;
      let errMsg: string | undefined;
      let errStack: string | undefined;

      try {
        result = await step.runTest();

        if (result === undefined) {
          status = "TestError";
        } else {
          status = this.classifyPassFail(result);
        }
      } catch (err) {
        status = "RailError";
        errMsg =
          err instanceof Error ? err.message : String(err ?? "unknown error");
        errStack = err instanceof Error ? err.stack : undefined;

        if (log?.error) {
          log.error(
            {
              event: "step_runTest_threw",
              index: indexRelativePath,
              stepIndex: i,
              stepCount: steps.length,
              handler: handlerName,
              error: errMsg,
            },
            "Pipeline step runTest() threw (RailError)"
          );
        }
      }

      // 4) Finalize record exactly once
      const finalizeInput: TestHandlerFinalizeInput = {
        testHandlerId,
        status,
        durationMs: Date.now() - startedAt,
        result: result,
        errorMessage: errMsg,
        errorStack: errStack,
      };

      try {
        await writer.finalizeHandlerTest(finalizeInput);
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
              intendedStatus: status,
            },
            "Failed to finalize handler-test record"
          );
        }

        // Continue: the run must proceed; run summary will reflect railErrors at the run level.
        continue;
      }
    }
  }

  private classifyPassFail(
    result: HandlerTestResult
  ): TestHandlerTerminalStatus {
    // Keep this logic tiny and defensive.
    // We do NOT interpret test semantics; we only map a common "passed" signal to status.
    const anyResult = result as any;

    if (typeof anyResult?.passed === "boolean") {
      return anyResult.passed ? "Passed" : "Failed";
    }

    const status =
      typeof anyResult?.status === "string" ? anyResult.status : "";
    const norm = status.toLowerCase();

    if (norm === "passed" || norm === "pass" || norm === "green")
      return "Passed";
    if (norm === "failed" || norm === "fail" || norm === "red") return "Failed";

    // If the shape is unknown, treat it as a failure signal rather than lying.
    return "Failed";
  }
}
