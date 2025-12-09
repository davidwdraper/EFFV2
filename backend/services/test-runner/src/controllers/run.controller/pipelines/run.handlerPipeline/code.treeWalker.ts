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
//  * - Walk the configured code root and discover handler pipeline index files
//  *   that are candidates for test execution.
//  * - Only consider index.ts files located under:
//  *     controllers/**/pipelines/**/<something>.handlerPipeline/index.ts
//  * - Project the discovery result into a singleton DtoBag<TestRunnerDto>
//  *   at ctx["bag"] so ControllerBase.finalize() can emit a normal wire response.
//  *
//  * Invariants:
//  * - Reads configuration exclusively via getVar(...) (env-service backed).
//  * - Idempotent per request: re-running the handler re-scans the tree and
//  *   overwrites ctx["testRunner.tree"] and ctx["bag"] with the latest view.
//  */

import { promises as fs } from "fs";
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
    return "Walk the configured code root and collect handler pipeline index files for the test-runner.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    let rootDir: string;
    try {
      // Env value comes from env-service via svcEnv; strict accessor enforced.
      rootDir = this.getVar("NV_TEST_RUNNER_ROOT", true);
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_root_missing",
        detail:
          "NV_TEST_RUNNER_ROOT is not configured for the test-runner service. Ops: add NV_TEST_RUNNER_ROOT to env-service for this service/env and retry.",
        stage: "getVar.NV_TEST_RUNNER_ROOT",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "test-runner.code.treeWalker: getVar('NV_TEST_RUNNER_ROOT') failed; test-runner cannot discover pipelines.",
        logLevel: "error",
      });
      return;
    }

    const normalizedRoot = path.resolve(rootDir);

    let stat;
    try {
      stat = await fs.stat(normalizedRoot);
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_root_inaccessible",
        detail:
          "Configured NV_TEST_RUNNER_ROOT does not exist or cannot be accessed. Ops: verify the path on disk and file-system permissions for the test-runner service.",
        stage: "fs.stat.root",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "test-runner.code.treeWalker: fs.stat(rootDir) failed; test-runner cannot walk the code tree.",
        logLevel: "error",
      });
      return;
    }

    if (!stat.isDirectory()) {
      this.failWithError({
        httpStatus: 500,
        title: "test_runner_root_not_directory",
        detail:
          "NV_TEST_RUNNER_ROOT is configured but does not point to a directory. Ops: update NV_TEST_RUNNER_ROOT to a valid directory that contains service code.",
        stage: "rootDir.validation",
        requestId,
        rawError: new Error("NV_TEST_RUNNER_ROOT is not a directory"),
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "test-runner.code.treeWalker: NV_TEST_RUNNER_ROOT is not a directory.",
        logLevel: "error",
      });
      return;
    }

    const discovered: TestRunnerDiscoveredPipeline[] = [];

    const walk = async (currentDir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch (err) {
        // Treat an unreadable subdirectory as a hard failure to keep behavior predictable.
        this.failWithError({
          httpStatus: 500,
          title: "test_runner_directory_unreadable",
          detail:
            "The test-runner encountered a directory it could not read while scanning for handler pipelines. Ops: verify file-system permissions beneath NV_TEST_RUNNER_ROOT.",
          stage: "fs.readdir.subdir",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "walk",
          },
          logMessage:
            "test-runner.code.treeWalker: fs.readdir failed while walking the code tree.",
          logLevel: "error",
        });
        throw err;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        const isIndexTs = entry.isFile() && entry.name === "index.ts";
        if (!isIndexTs) {
          continue;
        }

        // Enforce strict path structure:
        //   controllers/**/pipelines/**/<something>.handlerPipeline/index.ts
        const relativePath = path.relative(normalizedRoot, fullPath);
        const segments = relativePath.split(path.sep);

        const controllersIdx = segments.indexOf("controllers");
        const pipelinesIdx = segments.indexOf("pipelines");

        const hasRequiredFolderShape =
          controllersIdx >= 0 && pipelinesIdx > controllersIdx; // pipelines must be beneath controllers

        // Extra safety: ensure there is a *.handlerPipeline folder in the chain.
        const hasHandlerPipelineSegment = segments.some((seg) =>
          seg.endsWith(".handlerPipeline")
        );

        if (hasRequiredFolderShape && hasHandlerPipelineSegment) {
          discovered.push({
            absolutePath: fullPath,
            relativePath,
          });
        }
      }
    };

    try {
      await walk(normalizedRoot);
    } catch {
      // walk() already called failWithError; do not double-report.
      return;
    }

    const tree: TestRunnerCodeTree = {
      rootDir: normalizedRoot,
      pipelines: discovered,
    };

    // Keep raw tree on context for internal use / future handlers.
    this.ctx.set("testRunner.tree", tree);

    // Project into a TestRunnerDto and bag it so rails are happy.
    const dto = TestRunnerDto.fromBody(
      {
        rootDir: tree.rootDir,
        pipelines: tree.pipelines,
      },
      { validate: false }
    );

    // Ensure it has a canonical id for traceability (UUIDv4).
    dto.ensureId();

    const bag = new DtoBag([dto]);
    this.ctx.set("bag", bag);

    this.log.info(
      {
        event: "test_runner_tree_discovered",
        requestId,
        rootDir: normalizedRoot,
        pipelineCount: discovered.length,
      },
      "test-runner.code.treeWalker: discovered handler pipeline index files for test execution."
    );

    this.ctx.set("handlerStatus", "ok");
  }
}
