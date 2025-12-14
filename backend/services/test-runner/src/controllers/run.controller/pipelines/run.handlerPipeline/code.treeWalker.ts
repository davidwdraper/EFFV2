// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.treeWalker.ts
// /**
//  * Docs:
//  * - SOP: DTO-first; bag-centric processing for service APIs.
//  * - ADRs:
//  *   - ADR-0041 (Per-route controllers; single-purpose handlers)
//  *   - ADR-0042 (HandlerContext Bus — KISS)
//  *   - ADR-0058 (HandlerBase.getVar — Strict Env Accessor)
//  *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
//  *
//  * Purpose:
//  * - Walk the repo and discover pipeline index.ts modules that have handler tests.
//  *
//  * Discovery Rules (KISS, deterministic):
//  * - Candidate pipeline module = .../src/controllers/**/pipelines/**/index.ts
//  * - Include the pipeline ONLY if its folder contains at least one "*.test.ts"
//  *   file (side-by-side with handlers).
//  *
//  * Root Dir:
//  * - Prefer ctx["testRunner.rootDir"] if provided by the controller/route.
//  * - Otherwise require env var NV_REPO_ROOT from env-service (fail-fast).
//  *
//  * Logging:
//  * - Errors only.
//  */

import * as fs from "fs/promises";
import * as path from "path";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

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
    return "Walk repo to discover pipeline index.ts modules that contain handler-level tests (side-by-side *.test.ts).";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const rootDirFromCtx = this.safeCtxGet<string>("testRunner.rootDir");
    const rootDir =
      typeof rootDirFromCtx === "string" && rootDirFromCtx.trim()
        ? rootDirFromCtx.trim()
        : this.getVar("NV_REPO_ROOT", true);

    if (!rootDir || !rootDir.trim()) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_root_missing",
        detail:
          "Test-runner requires a repo root directory. Provide ctx['testRunner.rootDir'] or set NV_REPO_ROOT in env-service for test-runner.",
        stage: "code.treeWalker.rootDir.missing",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage: "test-runner.code.treeWalker: missing repo root.",
        logLevel: "error",
      });
      return;
    }

    const controllersRoot = path.join(rootDir, "backend", "services");

    let pipelines: TestRunnerDiscoveredPipeline[] = [];
    try {
      pipelines = await this.discoverPipelinesWithTests(
        controllersRoot,
        rootDir
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");

      this.failWithError({
        httpStatus: 500,
        title: "test_runner_tree_walk_failed",
        detail:
          "Failed while walking repo to discover pipelines. Ops: verify NV_REPO_ROOT and filesystem permissions; Dev: inspect error message for the failing path.",
        stage: "code.treeWalker.walk.failed",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage: `test-runner.code.treeWalker: walk failed: ${msg}`,
        logLevel: "error",
      });
      return;
    }

    const tree: TestRunnerCodeTree = {
      rootDir,
      pipelines,
    };

    this.ctx.set("testRunner.tree", tree);
    this.ctx.set("handlerStatus", "ok");
  }

  private async discoverPipelinesWithTests(
    servicesRoot: string,
    repoRoot: string
  ): Promise<TestRunnerDiscoveredPipeline[]> {
    const out: TestRunnerDiscoveredPipeline[] = [];

    // Walk backend/services/*/src/controllers/**/pipelines/**/index.ts
    const serviceDirs = await this.safeReadDir(servicesRoot);
    for (const svcName of serviceDirs) {
      const svcRoot = path.join(servicesRoot, svcName);
      const srcRoot = path.join(svcRoot, "src");
      const controllersRoot = path.join(srcRoot, "controllers");

      const hasControllers = await this.existsDir(controllersRoot);
      if (!hasControllers) continue;

      // Find all index.ts under any .../pipelines/... folders
      const candidates = await this.findFilesByName(
        controllersRoot,
        "index.ts"
      );

      for (const absIndexPath of candidates) {
        const norm = absIndexPath.split(path.sep).join("/");

        // Must contain "/pipelines/" to be treated as a pipeline module.
        if (!norm.includes("/pipelines/")) continue;

        const pipelineDir = path.dirname(absIndexPath);

        // Include only if the pipeline directory contains at least one *.test.ts file.
        const hasTests = await this.dirHasSuffixFile(pipelineDir, ".test.ts");
        if (!hasTests) continue;

        out.push({
          absolutePath: absIndexPath,
          relativePath: path.relative(repoRoot, absIndexPath),
        });
      }
    }

    // Stable ordering makes diffs and logs sane.
    out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return out;
  }

  private async safeReadDir(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  private async existsDir(dir: string): Promise<boolean> {
    try {
      const st = await fs.stat(dir);
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  private async findFilesByName(
    root: string,
    filename: string
  ): Promise<string[]> {
    const out: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: Array<import("fs").Dirent> = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          // Skip node_modules and dist-ish folders to keep it fast.
          if (
            e.name === "node_modules" ||
            e.name === "dist" ||
            e.name === "build"
          )
            continue;
          await walk(full);
          continue;
        }

        if (e.isFile() && e.name === filename) {
          out.push(full);
        }
      }
    };

    await walk(root);
    return out;
  }

  private async dirHasSuffixFile(
    dir: string,
    suffix: string
  ): Promise<boolean> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith(suffix)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
