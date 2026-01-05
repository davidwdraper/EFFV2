// backend/services/test-runner/src/svc/RunTests.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0050 (Wire Bag Envelope; bag-only edges)
 * - LDD-38 (Test Runner VNext Design)
 * - LDD-39 (StepIterator Micro-Contract — Revised, KISS)
 *
 * Purpose:
 * - Top-level orchestration entrypoint for the test-runner service.
 *
 * Dist-first invariant:
 * - Handler test modules are loaded from dist as CommonJS .js files.
 * - Sidecar module filename convention:
 *     <handlerName>.test.js
 *   e.g. code.build.userId.test.js
 */

import * as path from "path";

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DtoBag } from "@nv/shared/dto/DtoBag";

import { Guard } from "./Guard";
import { TreeWalker } from "./TreeWalker";
import { IndexIterator } from "./IndexIterator";
import { SvcTestRunWriter } from "./TestRunWriter";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

import type { HandlerTestModuleLoader } from "./ScenarioRunner";
import type { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";

export class RunTests {
  public constructor(
    private readonly ctx: HandlerContext,
    private readonly controller: ControllerBase
  ) {}

  public async execute(): Promise<void> {
    let runError: unknown | undefined;

    let walk:
      | {
          rootDir: string;
          pipelines: Array<{ absolutePath: string; relativePath: string }>;
        }
      | undefined;

    try {
      new Guard(this.controller).execute();

      walk = new TreeWalker().execute();

      const writer = this.buildSvcTestRunWriter();

      const testRunId = this.buildTestRunId();

      const moduleLoader = this.buildHandlerTestModuleLoader(walk.pipelines);

      await new IndexIterator(moduleLoader).execute({
        indices: walk.pipelines,
        rootDir: walk.rootDir, // <-- REQUIRED: enables target service dist/app.js load
        app: this.controller.getApp(), // test-runner app (NOT used to construct target controllers)
        pipelineLabel: "run",
        requestIdPrefix: "tr-local",
        writer,
        testRunId,
      });
    } catch (err) {
      runError = err;
    }

    /**
     * MOS invariant:
     * - test-runner does not invent its own DTO type.
     * - The success payload is intentionally minimal; we still return a bag so the
     *   controller edge stays bag-only.
     */
    const bag = new DtoBag([]);
    this.ctx.set("bag", bag);

    if (runError) {
      throw runError;
    }
  }

  // ─────────────── Internals ───────────────

  private buildSvcTestRunWriter(): SvcTestRunWriter {
    const log = this.ctx.get<any>("log");

    const appAny = this.controller.getApp() as any;
    const svcClient: SvcClient | undefined =
      appAny?.getSvcClient?.() ?? appAny?.getS2SClient?.();

    if (!svcClient) {
      const msg =
        "RunTests.buildSvcTestRunWriter: App is missing SvcClient; cannot construct TestRunWriter.";
      if (log?.error) {
        log.error({ event: "runTests_missing_svcClient" }, msg);
      }
      throw new Error(msg);
    }

    const env =
      (this.ctx.get<string>("envLabel") ??
        this.ctx.get<string>("env") ??
        "dev") ||
      "dev";

    const handlerTestVersion = 1;

    return new SvcTestRunWriter({
      svcClient,
      env,
      handlerTestVersion,
      log,
    });
  }

  /**
   * Dist-first, CommonJS-safe test module loader.
   *
   * Map:
   * - indexRelativePath (DTO / reporting) -> absolutePath (dist index.js)
   * - Then load sibling sidecar:
   *     <handlerName>.test.js
   */
  private buildHandlerTestModuleLoader(
    pipelines: Array<{ absolutePath: string; relativePath: string }>
  ): HandlerTestModuleLoader {
    const log = this.ctx.get<any>("log");

    const indexMap = new Map<string, string>();
    for (const p of pipelines) {
      indexMap.set(p.relativePath, p.absolutePath);
    }

    const loader: HandlerTestModuleLoader = {
      async loadFor(dto: HandlerTestDto) {
        const indexRel = dto.getIndexRelativePath();
        const handlerName = dto.getHandlerName();

        if (!indexRel || !handlerName) {
          return undefined;
        }

        const indexAbs = indexMap.get(indexRel);
        if (!indexAbs) {
          if (log?.warn) {
            log.warn(
              {
                event: "handlerTest_module_index_not_found",
                indexRelativePath: indexRel,
                handlerName,
              },
              "No index mapping found for HandlerTestDto.indexRelativePath"
            );
          }
          return undefined;
        }

        const dir = path.dirname(indexAbs);

        // Dist-first: compiled sidecar module.
        const candidate = path.join(dir, `${handlerName}.test.js`);

        try {
          // CommonJS-safe load.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod: any = require(candidate);

          if (!mod || typeof mod.getScenarios !== "function") {
            if (log?.warn) {
              log.warn(
                {
                  event: "handlerTest_module_missing_getScenarios",
                  testModulePath: candidate,
                  handlerName,
                },
                "Test module does not export getScenarios(deps)"
              );
            }
            return undefined;
          }

          return mod;
        } catch (err: any) {
          if (log?.info) {
            log.info(
              {
                event: "handlerTest_module_require_failed",
                testModulePath: candidate,
                handlerName,
                errorMessage: err?.message,
              },
              "Failed to require handler test module; treating as no tests"
            );
          }
          return undefined;
        }
      },
    };

    return loader;
  }

  private buildTestRunId(): string {
    const prefix = "tr-local";
    return `${prefix}-run-${Date.now()}`;
  }
}
