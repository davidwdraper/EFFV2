// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.planRuns.ts
/**
 * Docs:
 * - SOP + ADR-0073
 *
 * Purpose:
 * - Plan discovered pipelines into a TestRunDto bag for internal use.
 *
 * Logging:
 * - INFO once: list ONLY qualified pipeline index files (relative paths).
 *
 * IMPORTANT:
 * - Does NOT set ctx["bag"] anymore (keeps curl output lean).
 */

import * as path from "path";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { DtoBag } from "@nv/shared/dto/DtoBag";
import { TestRunDto } from "@nv/shared/dto/test-run.dto";
import type { TestRunnerCodeTree } from "./code.treeWalker";

export class CodePlanRunsHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Plan discovered pipelines into a DtoBag<TestRunDto> (internal planning only).";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");
    const tree = this.ctx.get<TestRunnerCodeTree>("testRunner.tree");

    if (!tree || !Array.isArray(tree.pipelines)) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_tree_missing",
        detail:
          "testRunner.tree missing/invalid. Ops: ensure code.treeWalker runs before code.planRuns.",
        stage: "code.planRuns.tree.missing",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "test-runner.code.planRuns: ctx['testRunner.tree'] missing.",
        logLevel: "error",
      });
      return;
    }

    const { rootDir, pipelines } = tree;

    if (!rootDir || pipelines.length === 0) {
      this.failWithError({
        httpStatus: 400,
        title: "test_runner_no_pipelines",
        detail:
          "No pipelines discovered under NV_TEST_RUNNER_ROOT. Dev: verify folder structure.",
        stage: "code.planRuns.pipelines.empty",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage: "test-runner.code.planRuns: no pipelines discovered.",
        logLevel: "warn",
      });
      return;
    }

    const env =
      (this.controller as any)?.getSvcEnv?.()?.env ??
      this.safeCtxGet<string>("envLabel") ??
      "";

    let dbState = "";
    try {
      dbState = this.getVar("DB_STATE", false) || "";
    } catch {
      dbState = "";
    }

    const dtos: TestRunDto[] = [];

    for (const p of pipelines) {
      const relPath = typeof p.relativePath === "string" ? p.relativePath : "";
      const segments = relPath.split(path.sep);

      const servicesIdx = segments.indexOf("services");
      const serviceSlug =
        servicesIdx >= 0 && servicesIdx + 1 < segments.length
          ? segments[servicesIdx + 1] ?? ""
          : "";

      const controllersIdx = segments.indexOf("controllers");
      const controllerName =
        controllersIdx >= 0 && controllersIdx + 1 < segments.length
          ? segments[controllersIdx + 1] ?? ""
          : "";

      const handlerPipelineSegment =
        segments.find((seg) => seg.endsWith(".handlerPipeline")) ?? "";
      const pipelineLabel = handlerPipelineSegment.replace(
        /\.handlerPipeline$/,
        ""
      );

      const effectiveServiceSlug = serviceSlug || "unknown-service";
      const effectiveControllerName = controllerName || "unknown.controller";
      const effectivePipelineLabel = pipelineLabel || "unknown.pipeline";

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
          status: "error",
          handlerCount: 0,
          passedHandlerCount: 0,
          failedHandlerCount: 0,
          errorHandlerCount: 0,
          startedAt: "",
          finishedAt: "",
          durationMs: 0,
          requestId,
        },
        { validate: false }
      );

      dto.setCollectionName(TestRunDto.dbCollectionName());
      dtos.push(dto);
    }

    const bag = new DtoBag<TestRunDto>(dtos);
    this.ctx.set("testRunner.runs", bag);

    this.log.info(
      {
        event: "test_runner_qualified_pipelines",
        requestId,
        pipelineCount: pipelines.length,
        files: pipelines.map((p) => p.relativePath),
      },
      "test-runner.code.planRuns: qualified handler pipeline index files."
    );

    this.ctx.set("handlerStatus", "ok");
  }
}
