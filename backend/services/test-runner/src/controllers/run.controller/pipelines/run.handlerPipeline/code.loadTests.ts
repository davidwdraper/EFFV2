// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.loadTests.ts
/**
 * Docs:
 * - SOP + ADR-0073
 *
 * Logging:
 * - Errors only (default).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import type {
  TestRunnerCodeTree,
  TestRunnerDiscoveredPipeline,
} from "./code.treeWalker";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface HandlerTestScenario {
  name?: string;
  handlerName?: string;
  dtoType?: string;
  [key: string]: any;
}

export interface TestRunnerPipelinePlan {
  pipeline: TestRunnerDiscoveredPipeline;
  hasTests: boolean;
  scenarioCount: number;
  scenarios: HandlerTestScenario[];
  error?: string;
}

export interface TestRunnerPlan {
  rootDir: string;
  pipelines: TestRunnerPipelinePlan[];
}

export class CodeLoadTestsHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Load discovered pipeline modules and construct a test-runner plan with per-pipeline test metadata.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");
    const tree = this.ctx.get<TestRunnerCodeTree>("testRunner.tree");

    if (!tree || !Array.isArray(tree.pipelines)) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_tree_missing",
        detail:
          "testRunner.tree missing/invalid. Ops: ensure code.treeWalker runs before code.loadTests.",
        stage: "testRunner.tree.missing",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "test-runner.code.loadTests: ctx['testRunner.tree'] missing.",
        logLevel: "error",
      });
      return;
    }

    const builder = new CodeTestPlanBuilder(this.log);
    const plan = await builder.buildPlan(tree, requestId);

    this.ctx.set("testRunner.plan", plan);
    this.ctx.set("handlerStatus", "ok");
  }
}

class CodeTestPlanBuilder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly log: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(log: any) {
    this.log = log;
  }

  public async buildPlan(
    tree: TestRunnerCodeTree,
    requestId: string | undefined
  ): Promise<TestRunnerPlan> {
    const pipelines: TestRunnerPipelinePlan[] = [];
    for (const pipeline of tree.pipelines) {
      pipelines.push(await this.inspectPipeline(pipeline, requestId));
    }
    return { rootDir: tree.rootDir, pipelines };
  }

  private async inspectPipeline(
    pipeline: TestRunnerDiscoveredPipeline,
    requestId: string | undefined
  ): Promise<TestRunnerPipelinePlan> {
    const { absolutePath, relativePath } = pipeline;

    let hasTests = false;
    let scenarioCount = 0;
    const scenarios: HandlerTestScenario[] = [];
    let error: string | undefined;

    try {
      const mod = await import(absolutePath as any);
      const rawScenarios =
        (mod as any).testScenarios ?? (mod as any).tests ?? null;

      if (Array.isArray(rawScenarios)) {
        hasTests = true;
        scenarioCount = rawScenarios.length;
        for (const s of rawScenarios)
          scenarios.push((s ?? {}) as HandlerTestScenario);
      }
    } catch (err) {
      error =
        (err as Error)?.message ??
        "Unknown error while importing pipeline module.";
      this.log.error(
        {
          event: "pipeline_tests_import_failed",
          requestId,
          relativePath,
          absolutePath,
          error,
        },
        "test-runner.code.loadTests: failed to import pipeline index.ts module."
      );
    }

    return { pipeline, hasTests, scenarioCount, scenarios, error };
  }
}
