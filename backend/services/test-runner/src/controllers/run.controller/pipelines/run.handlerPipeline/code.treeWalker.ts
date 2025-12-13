// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.treeWalker.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing for service APIs.
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0058 (HandlerBase.getVar — Strict Env Accessor)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - TEMP (next hour): bypass FS walk and return a hardcoded list of pipeline index.ts
 *   modules known to have handler tests, so we can stabilize rails and counts.
 *
 * Logging:
 * - Errors only.
 */

import * as path from "path";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { TestRunnerDto } from "@nv/shared/dto/test-runner.dto";
import { DtoBag } from "@nv/shared/dto/DtoBag";

export interface TestRunnerDiscoveredPipeline {
  absolutePath: string;
  relativePath: string;
}

export interface TestRunnerCodeTree {
  rootDir: string;
  pipelines: TestRunnerDiscoveredPipeline[];
}

export class CodeTreeWalkerHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "TEMP: return hardcoded pipeline index.ts file paths known to have tests (bypass FS walk).";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    // NOTE:
    // - Replace these two absolute paths with the exact two pipeline index.ts files
    //   you want to prove first.
    // - Keep them as ABSOLUTE paths for dynamic import compatibility.
    const hardcodedIndexFiles: string[] = [
      "/eff/backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/index.ts",
    ];

    const pipelines: TestRunnerDiscoveredPipeline[] = hardcodedIndexFiles
      .map((absPath) => String(absPath || "").trim())
      .filter(Boolean)
      .map((absPath) => ({
        absolutePath: absPath,
        // best-effort relative (purely for readability downstream)
        relativePath: absPath,
      }));

    if (pipelines.length === 0) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_hardcoded_pipelines_empty",
        detail:
          "Hardcoded test-runner pipeline list is empty. Dev: set two absolute index.ts paths in code.treeWalker.ts.",
        stage: "code.treeWalker.hardcoded.empty",
        requestId,
        rawError: null,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "test-runner.code.treeWalker: hardcoded pipeline list is empty.",
        logLevel: "error",
      });
      return;
    }

    // Root dir is best-effort: common-ish ancestor for display only.
    // (Do not overthink it; this is temporary.)
    const rootDir = path.parse(pipelines[0].absolutePath).root;

    const tree: TestRunnerCodeTree = {
      rootDir,
      pipelines,
    };

    this.ctx.set("testRunner.tree", tree);

    const dto = TestRunnerDto.fromBody(
      {
        rootDir: tree.rootDir,
        pipelines: tree.pipelines,
      },
      { validate: false }
    );

    dto.ensureId();

    this.ctx.set("bag", new DtoBag([dto]));
    this.ctx.set("handlerStatus", "ok");
  }
}
