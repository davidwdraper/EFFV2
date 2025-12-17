// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.runTests.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Single entry handler for the RUN pipeline.
 * - Delegates orchestration to svc/RunTests.execute().
 *
 * Invariants:
 * - This handler stays thin.
 * - Guard failures produce a structured 400 failed_guard (not a generic 500).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";

import { RunTests } from "../../../../svc/RunTests";

export class CodeRunTestsHandler extends HandlerBase {
  protected override handlerName(): string {
    return "code.runTests";
  }

  protected override handlerPurpose(): string {
    return "Run the test-runner orchestrator (guard first), producing a bagged response for the controller.";
  }

  protected override async execute(): Promise<void> {
    try {
      const svc = new RunTests(this.ctx, this.controller);
      await svc.execute();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");

      if (msg.startsWith("FAILED_GUARD:")) {
        this.failWithError({
          httpStatus: 400,
          title: "failed_guard",
          detail: msg,
          stage: "code.runTests:guard",
          rawError: err,
          logMessage: "test_runner_failed_guard",
          logLevel: "warn",
          origin: {
            handler: this.getHandlerName(),
            purpose: this.handlerPurpose(),
            method: "execute",
          },
        });
        return;
      }

      this.failWithError({
        httpStatus: 500,
        title: "test_runner_orchestrator_failed",
        detail:
          "Test-runner orchestration threw an unhandled exception. " +
          "Ops: search logs for 'test_runner_orchestrator_failed' and the requestId; " +
          "use origin.handler and origin.purpose to locate the failing step.",
        stage: "code.runTests:execute",
        rawError: err,
        logMessage: "test_runner_orchestrator_failed",
        logLevel: "error",
        origin: {
          handler: this.getHandlerName(),
          purpose: this.handlerPurpose(),
          method: "execute",
        },
      });
      return;
    }
  }
}
