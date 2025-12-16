// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/s2s.logTestRunStart.ts
/**
 * Docs:
 * - SOP + ADR-0073
 *
 * Logging:
 * - Errors only (default).
 *
 * Invariant:
 * - Best-effort persists a STARTED TestRun record early in the pipeline.
 * - Expects ctx["testRunner.runBag"] to be available after planning.
 * - Does NOT write any TestHandler records.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { TestRunDto } from "@nv/shared/dto/test-run.dto";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

export class S2sLogTestRunStartHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Best-effort S2S create of STARTED TestRun record to test-log (early breadcrumb).";
  }

  protected handlerName(): string {
    return "s2s.test-log.createTestRunStart";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");
    const runIdFromCtx = this.ctx.get<string>("testRunner.runId");

    const runBag =
      this.ctx.get<DtoBag<TestRunDto>>("testRunner.runBag") ?? null;

    if (!runBag) {
      this.log.error(
        {
          event: "test_runner_missing_runBag_for_start",
          requestId,
          runId: runIdFromCtx,
        },
        "test-runner.s2s.logTestRunStart: missing ctx['testRunner.runBag']; cannot create STARTED TestRun record."
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
        {
          event: "test_runner_no_svcclient_for_start",
          requestId,
          runId: runIdFromCtx,
        },
        "test-runner.s2s.logTestRunStart: SvcClient not available on App; cannot create STARTED TestRun record."
      );
      this.ctx.set("handlerStatus", "ok");
      return;
    }

    const envLabel = (this.controller as any)?.getSvcEnv?.()?.env ?? "";

    try {
      // Create a STARTED record early.
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
          event: "test_runner_s2s_create_run_start_failed",
          requestId,
          runId: runIdFromCtx,
          err:
            (err as Error)?.message ??
            "Unknown error during S2S create of STARTED TestRunDto bag.",
        },
        "test-runner.s2s.logTestRunStart: failed to create STARTED TestRun record (continuing)."
      );
    }

    this.ctx.set("handlerStatus", "ok");
  }
}
