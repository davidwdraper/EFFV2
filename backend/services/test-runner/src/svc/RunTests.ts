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
 * High-level flow:
 *   1) Guard: verify env + rails invariants (DB_STATE, DB_MOCKS, S2S_MOCKS, etc.).
 *   2) TreeWalker: discover all pipeline index files for the target service.
 *   3) Build the S2S-backed TestRunWriter (handler-test service client).
 *   4) Build a single testRunId for this invocation.
 *   5) IndexIterator:
 *        - For each pipeline index:
 *          • resolve controller + handler steps,
 *          • invoke StepIterator, which:
 *              - mints a fresh HandlerTestDto per handler step,
 *              - starts the record via TestRunWriter,
 *              - delegates scenario execution to ScenarioRunner
 *                (using HandlerTestModuleLoader),
 *              - finalizes the HandlerTestDto and HandlerTestRecord.
 *   6) Seed a final, bagged TestRunnerDto as the response payload.
 *
 * Invariants:
 * - Orchestrated steps may throw; RunTests MUST always:
 *     • seed a TestRunnerDto in a DtoBag at ctx["bag"], then
 *     • rethrow the original error (if any).
 * - Success payload MUST be a bag stored at ctx["bag"] (bag-only edge).
 * - DTO creation MUST use the service Registry (for TestRunnerDto).
 */

import * as path from "path";

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DtoBag } from "@nv/shared/dto/DtoBag";

import type { Registry } from "../registry/Registry";
import { Guard } from "./Guard";
import { TreeWalker } from "./TreeWalker";
import { IndexIterator, type IndexFile } from "./IndexIterator";
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
      // 1) Guard: ensure it's safe to run handler-level tests in this env.
      new Guard(this.controller).execute();

      // 2) Discover pipeline index files (TreeWalker owns traversal rules).
      walk = new TreeWalker().execute();

      // 3) Build the S2S-backed TestRunWriter (handler-test service client).
      const writer = this.buildSvcTestRunWriter();

      // 4) Mint one testRunId for this RunTests invocation.
      const testRunId = this.buildTestRunId();

      // 5) Build the HandlerTestModuleLoader (used by ScenarioRunner via StepIterator).
      const moduleLoader = this.buildHandlerTestModuleLoader(walk.pipelines);

      // 6) Iterate indices: IndexIterator → StepIterator → ScenarioRunner.
      await new IndexIterator(moduleLoader).execute({
        indices: walk.pipelines,
        app: this.controller.getApp(),
        pipelineLabel: "run",
        requestIdPrefix: "tr-local",
        writer,
        testRunId,
      });
    } catch (err) {
      // Capture but do NOT short-circuit the smoke payload.
      runError = err;
    }

    // 7) Smoke response ALWAYS (even on failure).
    //    TestRunnerDto gives callers visibility into what was scanned.
    const registry = this.controller.getDtoRegistry() as unknown as Registry;
    const dto = registry.newTestRunnerDto();

    if (walk) {
      dto.rootDir = walk.rootDir;
      dto.pipelines = walk.pipelines;
    }

    const bag = new DtoBag([dto]);
    this.ctx.set("bag", bag);

    if (runError) {
      throw runError;
    }
  }

  // ─────────────── Internals ───────────────

  /**
   * Build the canonical S2S-backed TestRunWriter.
   * No logging-only mode; if we can't construct this, it's a rails failure.
   */
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

    // Prefer env label from ctx; fall back to "dev" if not present.
    const env =
      (this.ctx.get<string>("envLabel") ??
        this.ctx.get<string>("env") ??
        "dev") ||
      "dev";

    // Handler-test service version: v1 for now; if/when we version,
    // we’ll thread this from config/DTO instead of hardcoding.
    const handlerTestVersion = 1;

    return new SvcTestRunWriter({
      svcClient,
      env,
      handlerTestVersion,
      log,
    });
  }

  /**
   * Build a HandlerTestModuleLoader that knows how to map:
   *   HandlerTestDto.{indexRelativePath, handlerName}
   * → absolute path to a test module.
   *
   * Convention (initial spike, can be tightened later):
   * - TreeWalker provides:
   *     pipelines: [{ absolutePath, relativePath }, ...]
   *   where absolutePath is the path to pipeline index.ts.
   *
   * - For a given handler test:
   *     • HandlerTestDto.indexRelativePath == pipeline.relativePath
   *     • HandlerTestDto.handlerName is the handler's getHandlerName()
   *
   * - We assume tests live alongside the pipeline index.ts and are named:
   *     <HandlerName>.test.ts
   *   e.g. CodeBuildUserIdHandler.test.ts
   *
   * - Test module must export getScenarios(): Promise<HandlerTestScenarioDef[]>
   *   as required by ScenarioRunner's HandlerTestModule contract.
   */
  private buildHandlerTestModuleLoader(
    pipelines: IndexFile[]
  ): HandlerTestModuleLoader {
    const log = this.ctx.get<any>("log");

    // Build a map from relative index path → absolute index path.
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

        // Directory containing the pipeline index.ts
        const dir = path.dirname(indexAbs);

        // Convention: <HandlerName>.test.ts in the same directory.
        const candidate = path.join(dir, `${handlerName}.test.ts`);

        try {
          const mod: any = await import(candidate);

          if (!mod || typeof mod.getScenarios !== "function") {
            if (log?.warn) {
              log.warn(
                {
                  event: "handlerTest_module_missing_getScenarios",
                  testModulePath: candidate,
                  handlerName,
                },
                "Test module does not export getScenarios()"
              );
            }
            return undefined;
          }

          return mod;
        } catch (err: any) {
          // Import failure is not fatal; ScenarioRunner will treat
          // "no module" as "no tests for this handler."
          if (log?.info) {
            log.info(
              {
                event: "handlerTest_module_import_failed",
                testModulePath: candidate,
                handlerName,
                errorMessage: err?.message,
              },
              "Failed to import handler test module; treating as no tests"
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
