// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.planRuns.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing for service APIs.
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Take the discovered code tree from CodeTreeWalkerHandler and project it
 *   into a bag of TestRunDto documents — one per pipeline discovered.
 *
 * Responsibilities:
 * - Read ctx["testRunner.tree"] (TestRunnerCodeTree).
 * - Derive serviceSlug, controllerName, pipelineLabel, pipelinePath per pipeline.
 * - Build a DtoBag<TestRunDto> representing planned runs.
 * - Seed ctx["bag"] with that DtoBag so downstream handlers (and finalize)
 *   can operate in the usual DTO-first way.
 *
 * Invariants:
 * - No handler execution here; this is a *planning* step only.
 * - No DB or S2S calls.
 * - On success: ctx["bag"] is a singleton DtoBag<TestRunDto>[].
 */

import * as path from "path";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { DtoBag } from "@nv/shared/dto/DtoBag";
import { TestRunDto } from "@nv/shared/dto/test-run.dto";
import type { TestRunnerCodeTree } from "./code.treeWalker"; // reuse the interface

export class CodePlanRunsHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Project discovered handler pipelines into a DtoBag<TestRunDto> representing planned test runs.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    // CodeTreeWalkerHandler should have seeded this.
    const tree = this.ctx.get<TestRunnerCodeTree>("testRunner.tree");

    if (!tree || !Array.isArray(tree.pipelines)) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_tree_missing",
        detail:
          "testRunner.tree was not found on the HandlerContext bus. Dev: ensure CodeTreeWalkerHandler runs before CodePlanRunsHandler.",
        stage: "code.planRuns.tree.missing",
        requestId,
        rawError: null,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "test-runner.code.planRuns: ctx['testRunner.tree'] missing or invalid.",
        logLevel: "error",
      });
      return;
    }

    const { rootDir, pipelines } = tree;

    if (!rootDir || !Array.isArray(pipelines) || pipelines.length === 0) {
      this.failWithError({
        httpStatus: 400,
        title: "test_runner_no_pipelines",
        detail:
          "The test-runner did not discover any handler pipelines under NV_TEST_RUNNER_ROOT. Dev: verify the configured root directory and pipeline folder structure.",
        stage: "code.planRuns.pipelines.empty",
        requestId,
        rawError: null,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "test-runner.code.planRuns: no pipelines discovered in testRunner.tree.",
        logLevel: "warn",
      });
      return;
    }

    // Try to pick up env + dbState for context; do NOT fail if missing.
    const env =
      this.safeCtxGet<string>("envLabel") ??
      this.safeCtxGet<string>("env") ??
      "dev";
    const dbState =
      this.safeCtxGet<string>("dbState") ??
      this.getVar("DB_STATE", false) ??
      "";

    const dtos: TestRunDto[] = [];

    for (const p of pipelines) {
      const relative = p.relativePath;
      const absolute = p.absolutePath;

      // Defensive: normalize/guard strings
      const relPath = typeof relative === "string" ? relative : "";
      const absPath = typeof absolute === "string" ? absolute : "";

      // Derive serviceSlug, controllerName, pipelineLabel from the path.
      // Expect shape roughly like:
      //   backend/services/<serviceSlug>/src/controllers/<controllerName>/pipelines/<pipelineFolder>/index.ts
      const segments = relPath.split(path.sep);

      const servicesIdx = segments.indexOf("services");
      let serviceSlug = "";
      if (servicesIdx >= 0 && servicesIdx + 1 < segments.length) {
        serviceSlug = segments[servicesIdx + 1] ?? "";
      }

      const controllersIdx = segments.indexOf("controllers");
      let controllerName = "";
      if (controllersIdx >= 0 && controllersIdx + 1 < segments.length) {
        controllerName = segments[controllersIdx + 1] ?? "";
      }

      // Find the *.handlerPipeline folder for a pipeline label
      const handlerPipelineSegment =
        segments.find((seg) => seg.endsWith(".handlerPipeline")) ?? "";
      const pipelineLabel = handlerPipelineSegment.replace(
        /\.handlerPipeline$/,
        ""
      );

      // Fallback labels if path parsing is weird
      const effectiveServiceSlug = serviceSlug || "unknown-service";
      const effectiveControllerName = controllerName || "unknown.controller";
      const effectivePipelineLabel = pipelineLabel || "unknown.pipeline";

      // Logical runId; this groups handler-level children in TestHandlerDto.
      const runId = [
        effectiveServiceSlug,
        effectiveControllerName,
        effectivePipelineLabel,
      ].join("::");

      const dto = TestRunDto.fromBody(
        {
          runId,

          env,
          dbState: dbState || undefined,

          serviceSlug: effectiveServiceSlug,
          serviceVersion: 1,

          controllerName: effectiveControllerName,
          controllerPath: relPath,

          pipelineLabel: effectivePipelineLabel,
          pipelinePath: relPath,

          status: "error", // default until a future handler updates this

          handlerCount: 0,
          passedHandlerCount: 0,
          failedHandlerCount: 0,
          errorHandlerCount: 0,

          startedAt: "",
          finishedAt: "",
          durationMs: 0,

          requestId,
          notes: undefined,
        },
        { validate: false }
      );

      // Ensure collectionName is set consistently
      dto.setCollectionName(TestRunDto.dbCollectionName());

      dtos.push(dto);
    }

    const bag = new DtoBag<TestRunDto>(dtos);

    // Make this bag the primary payload for downstream handlers & finalize().
    this.ctx.set("bag", bag);
    this.ctx.set("testRunner.runs", bag);

    this.log.info(
      {
        event: "test_runner_runs_planned",
        requestId,
        pipelineCount: pipelines.length,
        runCount: dtos.length,
        env,
        dbState: dbState || undefined,
      },
      "test-runner.code.planRuns: projected discovered pipelines into TestRunDto bag."
    );

    this.ctx.set("handlerStatus", "ok");
  }
}
