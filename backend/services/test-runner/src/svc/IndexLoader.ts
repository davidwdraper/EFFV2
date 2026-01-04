// backend/services/test-runner/src/svc/IndexLoader.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 *
 * Purpose:
 * - Load a pipeline index.ts file and resolve:
 *   1) its controller (via createController(app))
 *   2) its handler steps (via getSteps(ctx, controller))
 *
 * Scope:
 * - Resolution only. No execution.
 *
 * Dist-first invariant:
 * - indexAbsolutePath MUST point to the runtime-compiled dist index (.js).
 * - This loader MUST be CommonJS-safe in production.
 *
 * Test-runner invariant:
 * - Silently ignore any step whose handler name starts with "t_".
 *   (These are test-only helper steps that must not participate in discovery/execution.)
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

export class IndexLoader {
  public async execute(input: {
    indexAbsolutePath: string;
    ctx: HandlerContext;
    app: AppBase;
  }): Promise<{
    controller: ControllerJsonBase;
    steps: HandlerBase[];
  }> {
    const { indexAbsolutePath, ctx, app } = input;

    // CommonJS-safe load (dist-first). Do NOT rely on TS or ESM behavior.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: any = require(indexAbsolutePath);

    if (typeof mod.createController !== "function") {
      throw new Error(
        `INDEX_LOADER_INVALID_MODULE: ${indexAbsolutePath} does not export createController(app)`
      );
    }

    if (typeof mod.getSteps !== "function") {
      throw new Error(
        `INDEX_LOADER_INVALID_MODULE: ${indexAbsolutePath} does not export getSteps(ctx, controller)`
      );
    }

    const controller = mod.createController(app) as ControllerJsonBase;
    const stepsRaw = mod.getSteps(ctx, controller);

    if (!Array.isArray(stepsRaw)) {
      throw new Error(
        `INDEX_LOADER_INVALID_STEPS: getSteps() in ${indexAbsolutePath} did not return an array`
      );
    }

    // Test-only helper steps: silently skip any handler whose name starts with "t_".
    const steps = (stepsRaw as HandlerBase[]).filter((h) => {
      const name =
        typeof (h as any)?.getHandlerName === "function"
          ? String((h as any).getHandlerName())
          : typeof (h as any)?.handlerName === "function"
          ? String((h as any).handlerName())
          : String((h as any)?.constructor?.name ?? "");

      return !name.startsWith("t_");
    });

    return { controller, steps };
  }
}
