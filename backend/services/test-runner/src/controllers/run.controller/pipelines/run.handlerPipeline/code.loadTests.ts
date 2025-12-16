// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.loadTests.ts
/**
 * Docs:
 * - SOP + ADR-0073
 *
 * Purpose:
 * - Load discovered pipeline modules and instantiate real handler instances.
 * - NO standalone test module discovery.
 * - Test-runner calls handler.runTest() on each handler; default returns undefined.
 *
 * Logging:
 * - Errors only (default).
 *
 * Critical Harness Invariant:
 * - Foreign handlers (ex: auth) must be constructed with a controller that can supply a REAL AppBase.
 * - Handler tests (HandlerTestBase) will call harness.getApp().getSvcClient() to execute real S2S.
 * - Therefore: use the *real* controller (this.controller) as the harness controller.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import type {
  TestRunnerCodeTree,
  TestRunnerDiscoveredPipeline,
} from "./code.treeWalker";

export interface TestRunnerLoadedHandler {
  pipeline: TestRunnerDiscoveredPipeline;
  handler: HandlerBase;
}

export interface TestRunnerLoadSummary {
  pipelineCount: number;
  handlerCount: number;
  loadedPipelines: Array<{
    relativePath: string;
    handlerNames: string[];
  }>;
  failures: Array<{
    relativePath: string;
    absolutePath: string;
    error: string;
  }>;
}

export class CodeLoadTestsHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Load pipeline modules and instantiate handler objects so test-runner can call handler.runTest() (KISS).";
  }

  protected handlerName(): string {
    return "code.loadTests";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();
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

    const harnessController = this.makeHarnessController();

    const loaded: TestRunnerLoadedHandler[] = [];
    const failures: TestRunnerLoadSummary["failures"] = [];
    const loadedPipelines: TestRunnerLoadSummary["loadedPipelines"] = [];

    for (const pipeline of tree.pipelines) {
      const r = await this.loadOnePipeline(
        pipeline,
        harnessController,
        requestId
      );
      if (r.error) {
        failures.push({
          relativePath: pipeline.relativePath,
          absolutePath: pipeline.absolutePath,
          error: r.error,
        });
        continue;
      }

      loaded.push(...r.handlers);

      loadedPipelines.push({
        relativePath: pipeline.relativePath,
        handlerNames: r.handlers.map((h) => this.safeHandlerName(h.handler)),
      });
    }

    this.ctx.set("testRunner.handlers", loaded);

    const summary: TestRunnerLoadSummary = {
      pipelineCount: tree.pipelines.length,
      handlerCount: loaded.length,
      loadedPipelines,
      failures,
    };

    this.ctx.set("testRunner.loadSummary", summary);
    this.ctx.set("handlerStatus", "ok");
  }

  private safeHandlerName(handler: unknown): string {
    try {
      const anyH = handler as any;
      if (typeof anyH.handlerName === "function") {
        const n = anyH.handlerName();
        if (typeof n === "string" && n.trim() !== "") return n.trim();
      }
    } catch {
      // ignore
    }

    try {
      const ctor = (handler as any)?.constructor?.name;
      if (typeof ctor === "string" && ctor.trim() !== "") return ctor.trim();
    } catch {
      // ignore
    }

    return "(unknown-handler)";
  }

  private async loadOnePipeline(
    pipeline: TestRunnerDiscoveredPipeline,
    harnessController: ControllerJsonBase,
    requestId: string
  ): Promise<{ handlers: TestRunnerLoadedHandler[]; error?: string }> {
    try {
      // We import the pipeline index.ts module itself.
      const mod = await import(pipeline.absolutePath as any);
      const getSteps = (mod as any)?.getSteps;

      if (typeof getSteps !== "function") {
        return {
          handlers: [],
          error:
            "Imported pipeline module does not export getSteps(ctx, controller). " +
            "Dev: ensure pipeline index.ts exports getSteps.",
        };
      }

      // Each pipeline gets its own ctx for step construction (construction can seed ctx).
      const ctxForSteps = new (this.ctx.constructor as any)() as HandlerContext;
      ctxForSteps.set("requestId", requestId);

      const steps = getSteps(ctxForSteps, harnessController);

      if (!Array.isArray(steps)) {
        return {
          handlers: [],
          error:
            "Pipeline getSteps(...) did not return an array. Dev: pipeline must return handler instances.",
        };
      }

      const handlers: TestRunnerLoadedHandler[] = [];
      for (const h of steps) {
        if (h && typeof (h as any).run === "function") {
          handlers.push({ pipeline, handler: h as HandlerBase });
        }
      }

      return { handlers };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      this.log.error(
        {
          event: "pipeline_import_failed",
          requestId,
          relativePath: pipeline.relativePath,
          absolutePath: pipeline.absolutePath,
          error: msg,
        },
        "test-runner.code.loadTests: failed to import pipeline module."
      );
      return { handlers: [], error: msg };
    }
  }

  /**
   * Harness controller for constructing foreign handlers.
   *
   * Invariant:
   * - MUST expose a real AppBase so handler.runTest() can obtain a real SvcClient.
   *
   * Implementation:
   * - Reuse the currently executing controller (real app + real svcenv).
   */
  private makeHarnessController(): ControllerJsonBase {
    return this.controller as unknown as ControllerJsonBase;
  }
}
