// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/s2s.logToTestLog.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Final test-runner step that *attempts* to log the test results to the
 *   test-log service via S2S.
 * - Reads the DtoBag<TestRunDto> + DtoBag<TestHandlerDto> that upstream
 *   handlers placed on the bus and ships them to test-log as two creates:
 *     • /api/test-log/v1/test-run/create
 *     • /api/test-log/v1/test-handler/create
 *
 * Invariants:
 * - Never breaks the test-runner pipeline:
 *     • If SvcClient or bags are missing, it logs and exits with handlerStatus="ok".
 *     • If S2S logging fails, it logs and exits with handlerStatus="ok".
 * - DTO-only across the S2S boundary:
 *     • Body is always runBag.toBody() / handlerBag.toBody().
 *     • No ad-hoc summary objects are treated as contracts.
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
    return "S2S log of test-run + handler results to the test-log service (best-effort; never breaks the pipeline).";
  }

  /**
   * Optional explicit name for logging consistency.
   */
  protected handlerName(): string {
    return "s2s.logToTestLog";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");
    const runIdFromCtx = this.ctx.get<string>("testRunner.runId");

    this.log.debug(
      {
        event: "test_runner_s2s_log_enter",
        handler: this.handlerName(),
        requestId,
        runId: runIdFromCtx,
      },
      "test-runner.s2s.logToTestLog: enter"
    );

    // ---- Retrieve result bags from the bus (non-fatal if missing) ----------
    const runBag =
      this.ctx.get<DtoBag<TestRunDto>>("testRunner.runBag") ?? null;
    const handlerBag =
      this.ctx.get<DtoBag<TestHandlerDto>>("testRunner.handlerBag") ?? null;

    if (!runBag || !handlerBag) {
      this.log.warn(
        {
          event: "test_runner_s2s_missing_bags",
          requestId,
          hasRunBag: !!runBag,
          hasHandlerBag: !!handlerBag,
          runId: runIdFromCtx,
        },
        "test-runner.s2s.logToTestLog: required result bags missing; skipping S2S log step."
      );

      // Best-effort logger: do not fail the pipeline.
      this.ctx.set("handlerStatus", "ok");
      return;
    }

    // Try to pull a singleton TestRunDto for logging context only.
    let runDto: TestRunDto | undefined;
    try {
      runDto = runBag.getSingleton();
    } catch {
      runDto = undefined;
    }

    const handlerCount = (() => {
      try {
        return Array.from(handlerBag.items()).length;
      } catch {
        return 0;
      }
    })();

    // ---- Log a projection for Ops (view only; DTO remains the contract) ----
    this.log.info(
      {
        event: "test_runner_s2s_log_summary",
        requestId,
        runId: runDto?.runId ?? runIdFromCtx ?? "(unknown-runId)",
        status: runDto?.status ?? "error",
        env: runDto?.env ?? "(unknown-env)",
        dbState: runDto?.dbState ?? "(unknown-state)",
        handlerCount: runDto?.handlerCount ?? handlerCount,
        passedHandlerCount: runDto?.passedHandlerCount ?? 0,
        failedHandlerCount: runDto?.failedHandlerCount ?? 0,
        errorHandlerCount: runDto?.errorHandlerCount ?? 0,
        durationMs: runDto?.durationMs ?? 0,
        startedAt: runDto?.startedAt,
        finishedAt: runDto?.finishedAt,
      },
      "test-runner.s2s.logToTestLog: test-run summary ready for S2S logging."
    );

    // ---- Resolve SvcClient from the App (best-effort) ----------------------
    const app = (this.controller as any).getApp?.();
    const svcClient: SvcClient | undefined =
      app && typeof app.getSvcClient === "function"
        ? (app.getSvcClient() as SvcClient)
        : undefined;

    if (!svcClient) {
      this.log.warn(
        {
          event: "test_runner_s2s_no_svcclient",
          requestId,
          runId: runDto?.runId ?? runIdFromCtx ?? "(unknown-runId)",
        },
        "test-runner.s2s.logToTestLog: SvcClient not available on App; skipping S2S log."
      );

      this.ctx.set("handlerStatus", "ok");
      return;
    }

    const envLabel = this.controller.getSvcEnv().env;

    // ---- Best-effort S2S log to test-log (run + handlers) ------------------
    try {
      // 1) Persist TestRunDto bag
      await svcClient.call({
        env: envLabel,
        slug: "test-log",
        version: 1,
        dtoType: "test-run",
        op: "create",
        method: "PUT",
        bag: handlerBag, // NOTE: pass the bag, not .toBody()
        // optional, but recommended if you have them:
        // requestId: ctx.get("requestId"),
        // extraHeaders: { ... },
        // pathSuffix: "something/custom" // only if you need to override `<dtoType>/<op>`
      });

      this.log.debug(
        {
          event: "test_runner_s2s_log_run_ok",
          requestId,
          runId: runDto?.runId ?? runIdFromCtx ?? "(unknown-runId)",
        },
        "test-runner.s2s.logToTestLog: successfully logged TestRunDto bag to test-log."
      );
    } catch (err) {
      this.log.error(
        {
          event: "test_runner_s2s_log_run_failed",
          requestId,
          runId: runDto?.runId ?? runIdFromCtx ?? "(unknown-runId)",
          err:
            (err as Error)?.message ??
            "Unknown error during S2S log of TestRunDto bag.",
        },
        "test-runner.s2s.logToTestLog: failed to log TestRunDto bag to test-log (continuing)."
      );
      // Do not return; still attempt to log handlers.
    }

    try {
      // 2) Persist TestHandlerDto bag
      await svcClient.call({
        env: envLabel,
        slug: "test-log",
        version: 1,
        dtoType: "test-handler",
        op: "create",
        method: "PUT",
        bag: handlerBag, // NOTE: pass the bag, not .toBody()
        // optional, but recommended if you have them:
        // requestId: ctx.get("requestId"),
        // extraHeaders: { ... },
        // pathSuffix: "something/custom" // only if you need to override `<dtoType>/<op>`
      });

      this.log.debug(
        {
          event: "test_runner_s2s_log_handlers_ok",
          requestId,
          runId: runDto?.runId ?? runIdFromCtx ?? "(unknown-runId)",
          handlerCount,
        },
        "test-runner.s2s.logToTestLog: successfully logged TestHandlerDto bag to test-log."
      );
    } catch (err) {
      this.log.error(
        {
          event: "test_runner_s2s_log_handlers_failed",
          requestId,
          runId: runDto?.runId ?? runIdFromCtx ?? "(unknown-runId)",
          handlerCount,
          err:
            (err as Error)?.message ??
            "Unknown error during S2S log of TestHandlerDto bag.",
        },
        "test-runner.s2s.logToTestLog: failed to log TestHandlerDto bag to test-log (continuing)."
      );
    }

    // Best-effort: regardless of S2S outcome, we never fail the pipeline.
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "test_runner_s2s_log_exit",
        handler: this.handlerName(),
        requestId,
        runId: runDto?.runId ?? runIdFromCtx ?? "(unknown-runId)",
      },
      "test-runner.s2s.logToTestLog: exit"
    );
  }
}
