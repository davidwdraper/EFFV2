// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.seedRun.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Seed an invocation-level TestRunDto early in the pipeline so we can:
 *   1) Log a STARTED breadcrumb before test execution.
 *   2) Reuse the same runId/runBag for later finalization (PATCH).
 *
 * Invariants:
 * - Owns creation of ctx["testRunner.runId"] and ctx["testRunner.runBag"].
 * - Sets TestRunDto.status to "started" (early state).
 * - Does NOT set ctx["bag"] (keep curl output lean; CodeExecutePlan owns final response).
 */

import crypto from "crypto";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { DtoBag } from "@nv/shared/dto/DtoBag";
import { TestRunDto } from "@nv/shared/dto/test-run.dto";

export class CodeSeedRunHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Create an invocation-level TestRunDto (status=started) and store it in ctx['testRunner.runBag'] for early START logging + later finalize.";
  }

  protected handlerName(): string {
    return "code.seedRun";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const envLabel = (this.controller as any)?.getSvcEnv?.()?.env ?? "";

    let dbState = "";
    try {
      dbState = this.getVar("DB_STATE", false) || "";
    } catch {
      dbState = "";
    }

    // Runner identity (this service)
    const runnerServiceSlug = "test-runner";
    const runnerServiceVersion = 1;
    const runnerControllerName = "run.controller";
    const runnerPipelineLabel = "run.handlerPipeline";
    const runnerPipelinePath =
      "controllers/run.controller/pipelines/run.handlerPipeline";

    const runId = crypto.randomUUID();

    const startedAtMs = Date.now();
    const nowIso = new Date(startedAtMs).toISOString();

    const runDto = new TestRunDto({ createdAt: nowIso, updatedAt: nowIso });

    runDto.runId = runId;
    runDto.env = envLabel;
    runDto.dbState = dbState;

    // This run record is owned by test-runner (invocation-level).
    runDto.serviceSlug = runnerServiceSlug;
    runDto.serviceVersion = runnerServiceVersion;
    runDto.controllerName = runnerControllerName;
    runDto.controllerPath = runnerPipelinePath;
    runDto.pipelineLabel = runnerPipelineLabel;
    runDto.pipelinePath = runnerPipelinePath;

    runDto.requestId = requestId;

    // EARLY STATE (breadcrumb)
    runDto.status = "started";

    runDto.startedAt = nowIso;
    runDto.finishedAt = "";
    runDto.durationMs = 0;

    runDto.handlerCount = 0;
    runDto.passedHandlerCount = 0;
    runDto.failedHandlerCount = 0;
    runDto.errorHandlerCount = 0;

    const runBag = new DtoBag<TestRunDto>([runDto]);

    this.ctx.set("testRunner.runId", runId);
    this.ctx.set("testRunner.runBag", runBag);

    this.log.info(
      {
        event: "test_runner_seed_run",
        requestId,
        runId,
        env: envLabel,
        dbState,
      },
      "test-runner.code.seedRun: seeded STARTED runBag."
    );

    this.ctx.set("handlerStatus", "ok");
  }
}
