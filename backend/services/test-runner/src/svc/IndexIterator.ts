// backend/services/test-runner/src/svc/IndexIterator.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 *
 * Purpose:
 * - Procedural outer loop that:
 *   1) Builds a fresh HandlerContext per pipeline index.ts
 *   2) Loads the pipeline via IndexLoader
 *   3) Resolves controller + steps
 *   4) Iterates steps read-only (StepIterator)
 *
 * Current scope:
 * - Resolution + read-only step inspection. No handler execution.
 *
 * Invariants:
 * - Fresh ctx per index
 * - Deterministic ordering
 * - No queuing, no buffering
 * - No process.env access
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerContext as HandlerContextCtor } from "@nv/shared/http/handlers/HandlerContext";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { IndexLoader } from "./IndexLoader";
import { StepIterator } from "./StepIterator";

export type IndexFile = {
  absolutePath: string;
  relativePath: string;
};

export class IndexIterator {
  public constructor() {}

  public async execute(input: {
    indices: IndexFile[];
    app: AppBase;
    pipelineLabel?: string;
    requestIdPrefix?: string;
  }): Promise<void> {
    const label = input.pipelineLabel ?? "run";
    const prefix = input.requestIdPrefix ?? "tr-local";

    const loader = new IndexLoader();
    const stepIterator = new StepIterator();

    for (let i = 0; i < input.indices.length; i++) {
      const index = input.indices[i];

      // 1) Fresh context per pipeline index
      const ctx = this.buildPipelineContext({
        requestId: `${prefix}-${i}-${Date.now()}`,
        pipelineLabel: label,
        indexAbsolutePath: index.absolutePath,
        indexRelativePath: index.relativePath,
      });

      // 2) Load index + resolve controller + steps
      const { controller, steps } = await loader.execute({
        indexAbsolutePath: index.absolutePath,
        ctx,
        app: input.app,
      });

      // 3) Visibility: index load success
      const log = ctx.get<any>("log");
      if (log?.info) {
        log.info(
          {
            event: "index_loaded",
            index: index.relativePath,
            stepCount: steps.length,
            controller: controller.constructor.name,
          },
          "Pipeline index loaded"
        );
      }

      // 4) Read-only step inspection (no execution)
      await stepIterator.execute({
        ctx,
        controller,
        steps,
        indexRelativePath: index.relativePath,
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

    // Core rails
    ctx.set("requestId", input.requestId);
    ctx.set("status", 200);
    ctx.set("handlerStatus", "ok");

    // Metadata for debugging / writers / logging
    ctx.set("pipeline", input.pipelineLabel);
    ctx.set("testRunner.index.absolutePath", input.indexAbsolutePath);
    ctx.set("testRunner.index.relativePath", input.indexRelativePath);

    return ctx;
  }
}
