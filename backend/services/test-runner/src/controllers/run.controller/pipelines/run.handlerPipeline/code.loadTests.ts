// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.loadTests.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing for service APIs.
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Load discovered pipeline index.ts modules and build a test plan with
 *   per-pipeline test metadata and scenario lists.
 *
 * Responsibilities:
 * - Read ctx["testRunner.tree"] (produced by code.treeWalker.ts).
 * - dynamic-import each pipeline index.ts module.
 * - Look for exported test metadata:
 *     • `export const testScenarios = [...]` (preferred)
 *     • or `export const tests = [...]` (fallback).
 * - Build a strongly-shaped plan and store it at ctx["testRunner.plan"].
 *
 * Invariants:
 * - Does not touch ctx["bag"]; this is meta-only.
 * - Never throws for a single bad module; records an error per pipeline and
 *   continues so one bad pipeline does not poison the entire run.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import type {
  TestRunnerCodeTree,
  TestRunnerDiscoveredPipeline,
} from "./code.treeWalker";

/**
 * Minimal, flexible shape for a handler-level test scenario.
 * The actual scenario objects live in the pipeline index.ts modules.
 */
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

/**
 * Thin handler — delegates all heavy lifting to CodeTestPlanBuilder.
 */
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
          "test-runner code tree was not found on the HandlerContext bus. Ops: ensure code.treeWalker ran before code.loadTests.",
        stage: "testRunner.tree.missing",
        requestId,
        rawError: null,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "test-runner.code.loadTests: ctx['testRunner.tree'] missing or invalid.",
        logLevel: "error",
      });
      return;
    }

    this.log.debug(
      {
        event: "test_runner_load_tests_start",
        requestId,
        rootDir: tree.rootDir,
        pipelineCount: tree.pipelines.length,
      },
      "test-runner.code.loadTests: starting module inspection for test metadata."
    );

    const builder = new CodeTestPlanBuilder(this.log);
    const plan = await builder.buildPlan(tree, requestId);

    this.ctx.set("testRunner.plan", plan);

    this.log.info(
      {
        event: "test_runner_load_tests_complete",
        requestId,
        rootDir: plan.rootDir,
        pipelineCount: plan.pipelines.length,
        pipelinesWithTests: plan.pipelines.filter((p) => p.hasTests).length,
      },
      "test-runner.code.loadTests: test plan constructed from discovered pipelines."
    );

    this.ctx.set("handlerStatus", "ok");
  }
}

/**
 * Single-purpose helper: inspects pipeline modules and builds a TestRunnerPlan.
 */
class CodeTestPlanBuilder {
  // log is the controller-bound pino logger; we keep it loosely typed here.
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
      const plan = await this.inspectPipeline(pipeline, requestId);
      pipelines.push(plan);
    }

    return {
      rootDir: tree.rootDir,
      pipelines,
    };
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
      // NOTE:
      // - During dev (tsx) this is a .ts import.
      // - In build/dist this resolves to compiled JS.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = await import(absolutePath);

      // Preferred: `export const testScenarios = [...]`
      // Fallback:  `export const tests = [...]`
      const rawScenarios =
        (mod as any).testScenarios ?? (mod as any).tests ?? null;

      if (Array.isArray(rawScenarios)) {
        hasTests = true;
        scenarioCount = rawScenarios.length;
        for (const s of rawScenarios) {
          scenarios.push((s ?? {}) as HandlerTestScenario);
        }
      }

      this.log.debug(
        {
          event: "pipeline_tests_inspected",
          requestId,
          relativePath,
          absolutePath,
          hasTests,
          scenarioCount,
        },
        "test-runner.code.loadTests: inspected pipeline module for test metadata."
      );
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

    return {
      pipeline,
      hasTests,
      scenarioCount,
      scenarios,
      error,
    };
  }
}
