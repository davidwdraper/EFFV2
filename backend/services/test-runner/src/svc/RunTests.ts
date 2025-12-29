// backend/services/test-runner/src/svc/RunTests.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0050 (Wire Bag Envelope; bag-only edges)
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 * - ADR-0086 (MOS posture: may mint shared DTOs; no local DB registry)
 * - LDD-38 (Test Runner vNext Design)
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
 *              - mints a fresh HandlerTestDto per handler step (shared registry),
 *              - starts the record via TestRunWriter,
 *              - delegates scenario execution to ScenarioRunner
 *                (using HandlerTestModuleLoader),
 *              - finalizes the HandlerTestDto and HandlerTestRecord.
 *   6) Seed a final, bagged HandlerTestDto "summary" record as the response payload.
 *
 * Invariants:
 * - MOS posture MUST NOT call controller.getDtoRegistry() (DB-only rail).
 * - Response payload MUST be a bag stored at ctx["bag"] (bag-only edge).
 * - DTO minting MUST use shared registries for target DTOs (e.g., HandlerTestDtoRegistry).
 * - Orchestrated steps may throw; RunTests MUST always:
 *     • seed a DtoBag<HandlerTestDto> at ctx["bag"], then
 *     • rethrow the original error (if any).
 */

import * as path from "path";

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

import { HandlerTestDtoRegistry } from "@nv/shared/dto/registry/handler-test.dtoRegistry";
import type { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";

import { Guard } from "./Guard";
import { TreeWalker } from "./TreeWalker";
import { IndexIterator, type IndexFile } from "./IndexIterator";
import { SvcTestRunWriter, type TestRunWriter } from "./TestRunWriter";
import type { HandlerTestModuleLoader } from "./ScenarioRunner";

export class RunTests {
  public constructor(
    private readonly ctx: HandlerContext,
    private readonly controller: ControllerBase
  ) {}

  public async execute(): Promise<void> {
    const rt = this.controller.getRuntime();
    const log = this.controller.getLogger();

    const dtoReg = new HandlerTestDtoRegistry();

    let runError: unknown | undefined;

    let guard:
      | {
          dbState: string;
          dbMocks: boolean;
          s2sMocks: boolean;
        }
      | undefined;

    let walk:
      | {
          rootDir: string;
          pipelines: Array<{ absolutePath: string; relativePath: string }>;
        }
      | undefined;

    let testRunId: string | undefined;

    try {
      // 1) Guard: ensure it's safe to run handler-level tests in this env.
      guard = new Guard(this.controller).execute();

      // 2) Discover pipeline index files (TreeWalker owns traversal rules).
      walk = new TreeWalker().execute();

      // 3) Build the S2S-backed TestRunWriter (handler-test service client).
      const writer = this.buildSvcTestRunWriter();

      // 4) Mint one testRunId for this RunTests invocation.
      testRunId = this.buildTestRunId();

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
      // Capture but do NOT short-circuit the response bag.
      runError = err;

      const msg = err instanceof Error ? err.message : String(err ?? "unknown");
      log.warn(
        {
          event: "runTests_execute_failed",
          requestId: this.ctx.get<string>("requestId"),
          errorMessage: msg,
        },
        "RunTests caught error; will still return a bagged summary DTO"
      );
    }

    // 7) Response payload ALWAYS: a bag of HandlerTestDto (summary-only).
    //    This is NOT a persisted record unless some downstream writer persists it.
    const summary: HandlerTestDto = dtoReg.newHandlerTestDto();

    // Seed header where we have authoritative values.
    summary.setEnvOnce(rt.getEnv());
    if (guard) {
      summary.setDbStateOnce(guard.dbState);
      summary.setDbMocksOnce(guard.dbMocks);
      summary.setS2sMocksOnce(guard.s2sMocks);
    }

    // Identify this DTO as a runner-level summary (still a handler-test DTO type).
    // These strings are classification labels only; persistence is not implied.
    summary.setPipelineNameOnce("run");
    summary.setIndexRelativePathOnce("test-runner://scan");
    summary.setHandlerNameOnce("code.runTests.summary");
    summary.setHandlerPurposeOnce(
      "Summarize test-runner scan/execution results for the caller; not a persisted handler execution record."
    );

    summary.markStarted();
    summary.setRequestId(this.ctx.get<string>("requestId"));

    // Pack scan info into notes (DTO has no fields for it; notes is the rail-safe carrier).
    // Keep it readable and grep-friendly.
    if (testRunId) {
      summary.setNotes(`testRunId=${testRunId}`);
    } else {
      summary.setNotes(`testRunId=<missing>`);
    }

    if (walk) {
      const lines: string[] = [];
      lines.push(`rootDir=${walk.rootDir}`);
      lines.push(`pipelineCount=${walk.pipelines.length}`);

      // Avoid dumping enormous payloads; caller can inspect DB records for full detail.
      // Still include the first few pipeline rel paths as a sanity check.
      const sample = walk.pipelines.slice(0, 10).map((p) => p.relativePath);
      if (sample.length) {
        lines.push(`pipelinesSample=${JSON.stringify(sample)}`);
      }

      // Append to existing notes if present.
      const existing = summary.getNotes();
      const merged = existing
        ? `${existing}\n${lines.join("\n")}`
        : lines.join("\n");
      summary.setNotes(merged);
    }

    // Finalize timestamps for the summary record (no scenarios here).
    summary.setFinishedAt(new Date().toISOString());
    summary.finalizeFromScenarios(); // will mark Skipped (no scenarios), which is correct for summary-only

    const bag = new DtoBag([summary]);
    this.ctx.set("bag", bag);

    if (runError) {
      throw runError;
    }
  }

  // ─────────────── Internals ───────────────

  /**
   * Build the canonical S2S-backed TestRunWriter.
   *
   * Invariants:
   * - SvcClient comes from rt cap "s2s.svcClient" (no appAny hacks).
   * - Env comes from rt identity (no defaults/fallbacks).
   */
  private buildSvcTestRunWriter(): TestRunWriter {
    const rt = this.controller.getRuntime();
    const log = this.controller.getLogger();

    const svcClient = rt.getCap<SvcClient>("s2s.svcClient");
    const env = rt.getEnv();

    // Handler-test service version: v1 for now.
    // If/when this becomes configurable, it must come from runtime/vars with no defaults.
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
   * Convention (initial spike):
   * - Tests live alongside the pipeline index.ts and are named:
   *     <handlerName>.test.ts
   */
  private buildHandlerTestModuleLoader(
    pipelines: IndexFile[]
  ): HandlerTestModuleLoader {
    const log = this.controller.getLogger();

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
          log.warn(
            {
              event: "handlerTest_module_index_not_found",
              indexRelativePath: indexRel,
              handlerName,
            },
            "No index mapping found for HandlerTestDto.indexRelativePath"
          );
          return undefined;
        }

        const dir = path.dirname(indexAbs);
        const candidate = path.join(dir, `${handlerName}.test.ts`);

        try {
          const mod: any = await import(candidate);

          if (!mod || typeof mod.getScenarios !== "function") {
            log.warn(
              {
                event: "handlerTest_module_missing_getScenarios",
                testModulePath: candidate,
                handlerName,
              },
              "Test module does not export getScenarios()"
            );
            return undefined;
          }

          return mod;
        } catch (err: any) {
          // Import failure is not fatal; ScenarioRunner treats as "no tests".
          log.info(
            {
              event: "handlerTest_module_import_failed",
              testModulePath: candidate,
              handlerName,
              errorMessage: err?.message,
            },
            "Failed to import handler test module; treating as no tests"
          );
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
