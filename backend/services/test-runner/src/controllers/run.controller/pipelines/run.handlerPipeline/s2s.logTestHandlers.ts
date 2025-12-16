// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/s2s.logTestHandlers.ts
/**
 * Docs:
 * - SOP + ADR-0073
 *
 * Logging:
 * - Errors only (default).
 *
 * Invariant:
 * - Best-effort persists TestHandler results as the second-last step.
 * - MUST NOT attempt to log test-handler if there are 0 handler results.
 * - Does NOT create or update TestRun.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { TestHandlerDto } from "@nv/shared/dto/test-handler.dto";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

export class S2sLogTestHandlersHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Best-effort S2S create of TestHandler results to test-log (second-last step).";
  }

  protected handlerName(): string {
    return "s2s.test-log.createTestHandlers";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");
    const runIdFromCtx = this.ctx.get<string>("testRunner.runId");

    const handlerBag =
      this.ctx.get<DtoBag<TestHandlerDto>>("testRunner.handlerBag") ?? null;

    if (!handlerBag) {
      // Nothing to log is not an error; it can happen when 0 tests ran.
      this.ctx.set("handlerStatus", "ok");
      return;
    }

    let count = 0;
    try {
      for (const _ of handlerBag.items()) count += 1;
    } catch {
      count = 0;
    }

    if (count <= 0) {
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
        {
          event: "test_runner_no_svcclient_for_handlers",
          requestId,
          runId: runIdFromCtx,
        },
        "test-runner.s2s.logTestHandlers: SvcClient not available on App; cannot create TestHandler records."
      );
      this.ctx.set("handlerStatus", "ok");
      return;
    }

    const envLabel = (this.controller as any)?.getSvcEnv?.()?.env ?? "";

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
            "Unknown error during S2S create of TestHandlerDto bag.",
        },
        "test-runner.s2s.logTestHandlers: failed to create TestHandler records (continuing)."
      );
    }

    this.ctx.set("handlerStatus", "ok");
  }
}
