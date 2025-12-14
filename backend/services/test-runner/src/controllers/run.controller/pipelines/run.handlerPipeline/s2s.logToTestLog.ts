// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/s2s.logToTestLog.ts
/**
 * Docs:
 * - SOP + ADR-0073
 *
 * Logging:
 * - Errors only (default).
 *
 * Invariant:
 * - ALWAYS attempts to log a TestRun record to test-log, even if 0 tests ran.
 * - MUST NOT attempt to log test-handler if there are 0 handler results.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { TestRunDto } from "@nv/shared/dto/test-run.dto";
import type { TestHandlerDto } from "@nv/shared/dto/test-handler.dto";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

export class S2sLogToTestLogHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Best-effort S2S log of test-run + handler results to test-log (run is mandatory attempt).";
  }

  protected handlerName(): string {
    return "s2s.logToTestLog";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");
    const runIdFromCtx = this.ctx.get<string>("testRunner.runId");

    const runBag =
      this.ctx.get<DtoBag<TestRunDto>>("testRunner.runBag") ?? null;
    const handlerBag =
      this.ctx.get<DtoBag<TestHandlerDto>>("testRunner.handlerBag") ?? null;

    if (!runBag) {
      this.log.error(
        {
          event: "test_runner_missing_runBag",
          requestId,
          runId: runIdFromCtx,
        },
        "test-runner.s2s.logToTestLog: missing ctx['testRunner.runBag']; cannot log mandatory TestRun record."
      );

      this.ctx.set("handlerStatus", "ok");
      return;
    }

    const app = (this.controller as any).getApp?.();
    const svcClient: SvcClient | undefined =
      app && typeof app.getSvcClient === "function"
        ? (app.getSvcClient() as SvcClient)
        : undefined;

    if (!svcClient) {
      this.log.error(
        { event: "test_runner_no_svcclient", requestId, runId: runIdFromCtx },
        "test-runner.s2s.logToTestLog: SvcClient not available on App; cannot log TestRun record."
      );
      this.ctx.set("handlerStatus", "ok");
      return;
    }

    const envLabel = (this.controller as any)?.getSvcEnv?.()?.env ?? "";

    // 1) ALWAYS attempt to persist TestRunDto bag
    try {
      await svcClient.call({
        env: envLabel,
        slug: "test-log",
        version: 1,
        dtoType: "test-run",
        op: "create",
        method: "PUT",
        bag: runBag,
        requestId,
      });
    } catch (err) {
      this.log.error(
        {
          event: "test_runner_s2s_log_run_failed",
          requestId,
          runId: runIdFromCtx,
          err:
            (err as Error)?.message ??
            "Unknown error during S2S log of TestRunDto bag.",
        },
        "test-runner.s2s.logToTestLog: failed to log TestRunDto bag (continuing)."
      );
    }

    // 2) Best-effort persist handlers (ONLY if at least one item exists)
    if (handlerBag) {
      let count = 0;
      try {
        for (const _ of handlerBag.items()) count += 1;
      } catch {
        count = 0;
      }

      if (count > 0) {
        try {
          await svcClient.call({
            env: envLabel,
            slug: "test-log",
            version: 1,
            dtoType: "test-handler",
            op: "create",
            method: "PUT",
            bag: handlerBag,
            requestId,
          });
        } catch (err) {
          this.log.error(
            {
              event: "test_runner_s2s_log_handlers_failed",
              requestId,
              runId: runIdFromCtx,
              err:
                (err as Error)?.message ??
                "Unknown error during S2S log of TestHandlerDto bag.",
            },
            "test-runner.s2s.logToTestLog: failed to log TestHandlerDto bag (continuing)."
          );
        }
      }
    }

    this.ctx.set("handlerStatus", "ok");
  }
}
