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
 *   3) IndexIterator (load controller + steps, no execution yet)
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

      // 3) Iterate indices (controller + steps resolution only)
      await new IndexIterator().execute({
        indices: walk.pipelines,
        app: this.controller.getApp(),
        pipelineLabel: "run",
        requestIdPrefix: "tr-local",
      });
    } catch (err) {
      runError = err;
    }

    // 4) Smoke response ALWAYS
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
}
