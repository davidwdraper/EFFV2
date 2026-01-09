// backend/services/test-runner/src/svc/IndexIterator.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - LDD-38/39 (StepIterator Micro-Contract + VNext Orchestration)
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 * - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Procedural outer loop that:
 *    1) builds a fresh HandlerContext per pipeline entry module
 *    2) loads controller + StepDef[] plan WITHOUT instantiating handlers
 *    3) derives serviceSlug + version from relative path
 *    4) invokes StepIterator — one HandlerTestDto per step
 *
 * Naming note:
 * - This file name is legacy. It now iterates pipeline entry modules (not index.ts).
 */

import * as path from "path";

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerContext as HandlerContextCtor } from "@nv/shared/http/handlers/HandlerContext";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { envBootstrap } from "@nv/shared/bootstrap/envBootstrap";
import { DbEnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { SvcPosture } from "@nv/shared/runtime/SvcPosture";

import { StepIterator } from "./StepIterator";
import type { HandlerTestModuleLoader } from "./ScenarioRunner";
import type { TestRunWriter } from "./TestRunWriter";

import type {
  StepDefTest,
  RunMode,
} from "@nv/shared/base/pipeline/PipelineBase";

export type IndexFile = {
  absolutePath: string;
  relativePath: string;
};

type Target = {
  serviceSlug: string;
  serviceVersion: number;
};

export class IndexIterator {
  public constructor(private readonly moduleLoader: HandlerTestModuleLoader) {}

  public async execute(input: {
    indices: IndexFile[];
    rootDir: string;
    app: AppBase;
    pipelineLabel?: string;
    requestIdPrefix?: string;
    writer: TestRunWriter;
    testRunId: string;
  }): Promise<void> {
    const label = input.pipelineLabel ?? "run";
    const prefix = input.requestIdPrefix ?? "tr-local";

    const stepIterator = new StepIterator(this.moduleLoader);

    for (let i = 0; i < input.indices.length; i++) {
      const entry = input.indices[i];

      const ctx = this.buildPipelineContext({
        requestId: `${prefix}-${i}-${Date.now()}`,
        pipelineLabel: label,
        indexAbsolutePath: entry.absolutePath,
        indexRelativePath: entry.relativePath,
      });

      const target = this.deriveTargetFromIndex(entry.relativePath);
      const log = ctx.get<any>("log");

      let targetApp: AppBase | undefined;
      let controller: any;

      let pipelineName: string | undefined;
      let stepDefs: StepDefTest[] | undefined;

      try {
        // 1) Build target service virtual server (rt) via envBootstrap
        targetApp = await this.loadTargetServiceApp({
          rootDir: input.rootDir,
          target,
          log,
        });

        // 2) Load pipeline module exports (dist-first) WITHOUT instantiating handlers
        const mod = this.requirePipelineModule(entry.absolutePath);

        if (typeof mod?.createController !== "function") {
          throw new Error(
            `TEST_RUNNER_PIPELINE_CREATE_CONTROLLER_MISSING: module did not export createController(app). entry=${entry.relativePath}`
          );
        }
        controller = await Promise.resolve(mod.createController(targetApp));

        // Plan: ONE list (steps + expectedTestName), requested by you.
        if (typeof mod?.getPipelineSteps !== "function") {
          throw new Error(
            `TEST_RUNNER_PIPELINE_STEPS_MISSING: module did not export getPipelineSteps(runMode?). entry=${entry.relativePath}`
          );
        }

        // Runner always asks for "test" shape so expectedTestName is present/available.
        const runMode: RunMode = "test";
        stepDefs = await Promise.resolve(mod.getPipelineSteps(runMode));

        // best-effort pipeline name (optional; can be upgraded to a required export later)
        if (typeof mod?.pipelineName === "string") {
          pipelineName = String(mod.pipelineName).trim();
        }

        // 3) Virtual-server runtime: seed rt onto pipeline ctx so scenario ctx can inherit it.
        const rt =
          typeof (controller as any)?.getRuntime === "function"
            ? (controller as any).getRuntime()
            : undefined;

        if (!rt) {
          throw new Error(
            "SvcRuntime is required: ControllerBase.getRuntime() returned null/undefined. Ops: ensure the service is SvcRuntime'd before wiring handlers."
          );
        }
        ctx.set("rt", rt);

        // 4) Validate enough for runner safety
        if (!Array.isArray(stepDefs) || stepDefs.length === 0) {
          throw new Error(
            `TEST_RUNNER_PIPELINE_PLAN_INVALID: getPipelineSteps("test") returned empty/non-array. entry=${entry.relativePath}`
          );
        }

        log?.info?.(
          {
            event: "pipeline_module_loaded",
            entry: entry.relativePath,
            stepCount: stepDefs.length,
            controller: controller?.constructor?.name,
            targetServiceSlug: target.serviceSlug,
            targetServiceVersion: target.serviceVersion,
          },
          "Pipeline module loaded (plan-first, no handler instantiation)"
        );
      } catch (err: any) {
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        log?.error?.(
          {
            event: "pipeline_boot_failed",
            entry: entry.relativePath,
            targetServiceSlug: target.serviceSlug,
            targetServiceVersion: target.serviceVersion,
            errorMessage: msg,
          },
          "IndexIterator: pipeline boot failed (rails failure, not a handler test failure)"
        );

        throw err;
      }

      // From here on, targetApp/controller/stepDefs are guaranteed.
      await stepIterator.execute({
        ctx,
        controller: controller as any,
        stepDefs: stepDefs as StepDefTest[],
        indexRelativePath: entry.relativePath,
        pipelineName,
        testRunId: input.testRunId,
        writer: input.writer,
        target,
        app: targetApp as AppBase,
      });
    }
  }

  private requirePipelineModule(absPath: string): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: any = require(absPath);
    return mod;
  }

  private buildPipelineContext(input: {
    requestId: string;
    pipelineLabel: string;
    indexAbsolutePath: string;
    indexRelativePath: string;
  }): HandlerContext {
    const ctx = new HandlerContextCtor();

    ctx.set("requestId", input.requestId);
    ctx.set("status", 200);
    ctx.set("handlerStatus", "ok");

    ctx.set("pipeline", input.pipelineLabel);
    ctx.set("testRunner.index.absolutePath", input.indexAbsolutePath);
    ctx.set("testRunner.index.relativePath", input.indexRelativePath);

    return ctx;
  }

  private deriveTargetFromIndex(indexRelativePath: string): Target {
    const match = indexRelativePath.match(/backend\/services\/([^/]+)\//);
    const slug = match?.[1] ?? "unknown";

    return {
      serviceSlug: slug,
      serviceVersion: 1,
    };
  }

  private extractPrimaryEnvDto(
    envBag: DtoBag<DbEnvServiceDto>
  ): DbEnvServiceDto {
    const it = envBag.items();
    const first = it.next();
    const primary: DbEnvServiceDto | undefined = first.done
      ? undefined
      : first.value;

    if (!primary) {
      throw new Error(
        "BOOTSTRAP_ENV_BAG_EMPTY_AT_TEST_RUNNER: No DbEnvServiceDto in envBag after envBootstrap. " +
          "Ops: verify env-service has a config record for this service (env@slug@version)."
      );
    }

    return primary;
  }

  private adaptEnvReloader(
    envReloader: () => Promise<DtoBag<DbEnvServiceDto>>
  ): () => Promise<DbEnvServiceDto> {
    return async (): Promise<DbEnvServiceDto> => {
      const bag = await envReloader();
      const it = bag.items();
      const first = it.next();
      const primary: DbEnvServiceDto | undefined = first.done
        ? undefined
        : first.value;

      if (!primary) {
        throw new Error(
          "ENV_RELOADER_EMPTY_BAG_AT_TEST_RUNNER: envReloader returned an empty bag. " +
            "Ops: ensure the service’s DbEnvServiceDto config record still exists in env-service."
        );
      }

      return primary;
    };
  }

  private async loadTargetServiceApp(input: {
    rootDir: string;
    target: Target;
    log?: any;
  }): Promise<AppBase> {
    const { rootDir, target, log } = input;
    const { serviceSlug, serviceVersion } = target;

    if (!rootDir || !serviceSlug || serviceSlug === "unknown") {
      throw new Error(
        `IndexIterator.loadTargetServiceApp: invalid target rootDir="${rootDir}" serviceSlug="${serviceSlug}"`
      );
    }

    const appJs = path.join(
      rootDir,
      "backend",
      "services",
      serviceSlug,
      "dist",
      "app.js"
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: any = require(appJs);

    const posture: SvcPosture | undefined =
      (mod?.POSTURE as SvcPosture | undefined) ??
      (mod?.posture as SvcPosture | undefined);

    if (!posture) {
      const exportedKeys = mod ? Object.keys(mod).sort().join(",") : "";
      throw new Error(
        [
          "TEST_RUNNER_TARGET_POSTURE_MISSING: target dist/app.js did not export POSTURE (or posture).",
          `Target: ${serviceSlug}@${serviceVersion}`,
          `Module: ${appJs}`,
          `Exports: [${exportedKeys}]`,
          "Ops/Dev: patch the template so every service dist/app.js exports POSTURE, then re-clone services.",
        ].join(" ")
      );
    }

    if (typeof mod?.createAppBase !== "function") {
      const exportedKeys = mod ? Object.keys(mod).sort().join(",") : "";
      throw new Error(
        [
          "TEST_RUNNER_TARGET_CREATE_APP_BASE_MISSING: target dist/app.js did not export createAppBase(opts).",
          `Target: ${serviceSlug}@${serviceVersion}`,
          `Module: ${appJs}`,
          `Exports: [${exportedKeys}]`,
          "Ops/Dev: patch the template so every service exports createAppBase(opts) for runner use (no HTTP listener), then re-clone services.",
        ].join(" ")
      );
    }

    const { envLabel, envBag, envReloader, rt } = await envBootstrap({
      slug: serviceSlug,
      version: serviceVersion,
      posture,
    });

    const envDto = this.extractPrimaryEnvDto(envBag);
    const envReloaderForApp = this.adaptEnvReloader(envReloader);

    const opts = {
      slug: serviceSlug,
      version: serviceVersion,
      posture,
      envLabel,
      envDto,
      envReloader: envReloaderForApp,
      rt,
    };

    log?.info?.(
      {
        event: "virtual_server_built",
        targetServiceSlug: serviceSlug,
        targetServiceVersion: serviceVersion,
        posture,
        envLabel,
      },
      "Test-runner: constructed virtual server runtime (rt) via envBootstrap"
    );

    const candidate = await Promise.resolve(mod.createAppBase(opts));

    if (!candidate || typeof candidate.getLogger !== "function") {
      const ctorName = candidate?.constructor?.name ?? typeof candidate;
      throw new Error(
        [
          "IndexIterator.loadTargetServiceApp: createAppBase(opts) did not return a real AppBase.",
          `Target: ${serviceSlug}@${serviceVersion}`,
          `Module: ${appJs}`,
          `Candidate: ${ctorName}`,
        ].join(" ")
      );
    }

    return candidate as AppBase;
  }
}
