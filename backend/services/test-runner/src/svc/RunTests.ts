// backend/services/test-runner/src/svc/RunTests.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0050 (Wire Bag Envelope; bag-only edges)
 *
 * Purpose:
 * - Orchestration service for test-runner vNext.
 *
 * Current flow:
 *   1) Guard
 *   2) TreeWalker (V1)
 *   3) IndexIterator (load controller + steps, execute StepIterator)
 *   4) Seed smoke DTO bag
 *
 * Invariants:
 * - Orchestrated steps may throw; capture, still seed smoke bag, then rethrow.
 * - Success payload MUST be a bag stored at ctx["bag"].
 * - DTO creation MUST use the service Registry.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DtoBag } from "@nv/shared/dto/DtoBag";

import type { Registry } from "../registry/Registry";
import { Guard } from "./Guard";
import { TreeWalker } from "./TreeWalker";
import { IndexIterator } from "./IndexIterator";
import { SvcTestRunWriter } from "./TestRunWriter";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

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
      // 1) Guard
      new Guard(this.controller).execute();

      // 2) Discover pipeline index files
      walk = new TreeWalker().execute();

      // 3) Build the S2S-backed TestRunWriter (no log-only fallback).
      const writer = this.buildSvcTestRunWriter();

      // Single testRunId per RunTests invocation.
      const testRunId = this.buildTestRunId();

      // 4) Iterate indices (controller + steps resolution + StepIterator)
      await new IndexIterator().execute({
        indices: walk.pipelines,
        app: this.controller.getApp(),
        pipelineLabel: "run",
        requestIdPrefix: "tr-local",
        writer,
        testRunId,
      });
    } catch (err) {
      runError = err;
    }

    // 5) Smoke response ALWAYS
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
    // we'll thread this from config/DTO instead of hardcoding.
    const handlerTestVersion = 1;

    return new SvcTestRunWriter({
      svcClient,
      env,
      handlerTestVersion,
      log,
    });
  }

  private buildTestRunId(): string {
    const prefix = "tr-local";
    return `${prefix}-run-${Date.now()}`;
  }
}
