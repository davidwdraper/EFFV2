// backend/services/test-runner/src/svc/IndexIterator.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - LDD-38/39 (StepIterator Micro-Contract + VNext Orchestration)
 *
 * Purpose:
 * - Procedural outer loop that:
 *    1) builds a fresh HandlerContext per pipeline index.ts
 *    2) loads the pipeline via IndexLoader (controller + steps)
 *    3) derives serviceSlug + version from relative path
 *    4) invokes StepIterator — one HandlerTestDto per handler step
 *
 * Scope:
 * - Resolution + delegation only.
 * - NO scenario logic here.
 * - NO Test DTO mutation here.
 * - NO test-module loading here.
 *
 * Invariants:
 * - fresh ctx per index path
 * - deterministic iteration
 * - no buffering, queues, retries
 * - no process.env access
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerContext as HandlerContextCtor } from "@nv/shared/http/handlers/HandlerContext";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { IndexLoader } from "./IndexLoader";
import { StepIterator } from "./StepIterator";
import type { TestRunWriter } from "./TestRunWriter";
import type { HandlerTestModuleLoader } from "./ScenarioRunner";

export type IndexFile = {
  absolutePath: string;
  relativePath: string;
};

export class IndexIterator {
  public constructor(
    private readonly moduleLoader: HandlerTestModuleLoader // injected for ScenarioRunner use
  ) {}

  public async execute(input: {
    indices: IndexFile[];
    app: AppBase;
    pipelineLabel?: string;
    requestIdPrefix?: string;
    writer: TestRunWriter;
    testRunId: string;
  }): Promise<void> {
    const label = input.pipelineLabel ?? "run";
    const prefix = input.requestIdPrefix ?? "tr-local";

    const loader = new IndexLoader();
    const stepIterator = new StepIterator(this.moduleLoader);

    for (let i = 0; i < input.indices.length; i++) {
      const index = input.indices[i];

      // 1) New context per pipeline index file
      const ctx = this.buildPipelineContext({
        requestId: `${prefix}-${i}-${Date.now()}`,
        pipelineLabel: label,
        indexAbsolutePath: index.absolutePath,
        indexRelativePath: index.relativePath,
      });

      // 2) Resolve controller + steps from index.ts
      const { controller, steps } = await loader.execute({
        indexAbsolutePath: index.absolutePath,
        ctx,
        app: input.app,
      });

      const log = ctx.get<any>("log");
      log?.info?.(
        {
          event: "index_loaded",
          index: index.relativePath,
          stepCount: steps.length,
          controller: controller.constructor.name,
        },
        "Pipeline index loaded"
      );

      // 3) Derive metadata: serviceSlug + serviceVersion
      const target = this.deriveTargetFromIndex(index.relativePath);

      // 4) StepIterator executes handler tests via ScenarioRunner
      await stepIterator.execute({
        ctx,
        controller,
        steps,
        indexRelativePath: index.relativePath,
        testRunId: input.testRunId,
        writer: input.writer,
        target,
      });
    }
  }

  private buildPipelineContext(input: {
    requestId: string;
    pipelineLabel: string;
    indexAbsolutePath: string;
    indexRelativePath: string;
  }): HandlerContext {
    const ctx = new HandlerContextCtor();

    // Core rails metadata
    ctx.set("requestId", input.requestId);
    ctx.set("status", 200);
    ctx.set("handlerStatus", "ok");

    // Visibility for logging + persistence
    ctx.set("pipeline", input.pipelineLabel);
    ctx.set("testRunner.index.absolutePath", input.indexAbsolutePath);
    ctx.set("testRunner.index.relativePath", input.indexRelativePath);

    return ctx;
  }

  /**
   * Derive target service metadata from index relative path.
   * Convention:
   *   backend/services/<slug>/src/controllers/...
   *
   * version is v1 until multi-version test pipelines arrive.
   */
  private deriveTargetFromIndex(indexRelativePath: string): {
    serviceSlug: string;
    serviceVersion: number;
  } {
    const match = indexRelativePath.match(/backend\/services\/([^/]+)\//);
    const slug = match?.[1] ?? "unknown";

    return {
      serviceSlug: slug,
      serviceVersion: 1,
    };
  }
}
