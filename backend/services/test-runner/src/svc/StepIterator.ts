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
 * - For opted-in handlers:
 *     • mint a HandlerTestDto as the canonical record
 *     • writer.start(dto) immediately
 *     • expose the dto to the handler's runTest()
 *     • classify the outcome:
 *         - Passed / Failed (from returned payload)
 *         - TestError (runTest() returned undefined)
 *         - RailError (runTest() threw)
 *     • patch the dto with outcome/duration/error info
 *     • writer.finalize(dto)
 *
 * Non-responsibilities:
 * - No plans, no scenarios, no assertions, no test internals.
 * - No swallowing errors silently: every failure path is persisted + logged.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

import type { TestHandlerTerminalStatus, TestRunWriter } from "./TestRunWriter";
import { HandlerTestDtoRegistry } from "@nv/shared/dto/registry/handler-test.dtoRegistry";
import type { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";

export class StepIterator {
  /**
   * Shared registry for minting HandlerTestDto instances. Lives here so:
   * - we do NOT reach across service boundaries into handler-test/Registry
   * - every step uses the same minting rails (secret, collection, etc.)
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
    target?: {
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

      // 2) Opted-in => mint a HandlerTestDto as canonical record
      const startedAt = Date.now();
      const handlerTestDto = this.handlerTestRegistry.newHandlerTestDto();

      // Defensive target metadata handling: missing target should NOT crash
      const targetServiceSlug = target?.serviceSlug ?? "unknown";
      const targetServiceVersion = target?.serviceVersion ?? 0;

      if (!target && log?.warn) {
        log.warn(
          {
            event: "step_missing_target_metadata",
            index: indexRelativePath,
            stepIndex: i,
            stepCount: steps.length,
            handler: handlerName,
          },
          "StepIterator called without target metadata; using fallback values"
        );
      }

      // Seed DTO with everything StepIterator knows at START.
      // Field names are intentionally generic; HandlerTestDto is the single
      // source of truth and can be evolved without touching StepIterator's shape.
      (handlerTestDto as any).testRunId = testRunId;
      (handlerTestDto as any).indexRelativePath = indexRelativePath;
      (handlerTestDto as any).stepIndex = i;
      (handlerTestDto as any).stepCount = steps.length;
      (handlerTestDto as any).handlerName = handlerName;
      (handlerTestDto as any).targetServiceSlug = targetServiceSlug;
      (handlerTestDto as any).targetServiceVersion = targetServiceVersion;
      (handlerTestDto as any).startedAt = new Date(startedAt).toISOString();

      // Expose the DTO on the HandlerContext so handler-owned tests can find
      // and mutate it without new parameters if they prefer that pattern.
      try {
        (ctx as any).set?.("handlerTest.dto", handlerTestDto);
      } catch {
        // If ctx.set doesn't exist, tests can still receive the dto via runTest(dto).
      }

      // 3) Start: immediately persist the new record via the dumb writer.
      try {
        await writer.startHandlerTest(handlerTestDto);
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

      // 4) Execute runTest() and classify outcome
      let status: TestHandlerTerminalStatus;
      let result: HandlerTestResult | undefined;
      let errMsg: string | undefined;
      let errStack: string | undefined;

      try {
        // Note: This assumes HandlerBase.runTest(testDto: HandlerTestDto)
        // per ADR-0077. Handlers that don't care can ignore the argument.
        result = await (step as any).runTest(handlerTestDto);

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

      // 5) Patch DTO with final status + timing + any error payload
      const durationMs = Date.now() - startedAt;

      (handlerTestDto as any).terminalStatus = status;
      (handlerTestDto as any).durationMs = durationMs;
      (handlerTestDto as any).errorMessage = errMsg;
      (handlerTestDto as any).errorStack = errStack;
      (handlerTestDto as any).rawResult = result ?? null;

      // 6) Finalize record exactly once
      try {
        await writer.finalizeHandlerTest(handlerTestDto);
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

        // Continue: the run must proceed; run summary will reflect railErrors
        // at the run level.
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
