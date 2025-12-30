// backend/services/test-runner/src/svc/IndexIterator.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - LDD-38/39 (StepIterator Micro-Contract + VNext Orchestration)
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 * - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Procedural outer loop that:
 *    1) builds a fresh HandlerContext per pipeline index.ts
 *    2) loads the pipeline via IndexLoader (controller + steps)
 *    3) derives serviceSlug + version from relative path
 *    4) invokes StepIterator — one HandlerTestDto per handler step
 *
 * Critical invariant (virtual server):
 * - The target pipeline controller MUST be constructed using the TARGET service AppBase,
 *   not the test-runner AppBase.
 * - Runtime (SvcRuntime) is per pipeline (“virtual server”), not per handler.
 * - Scenario contexts MUST inherit the pipeline runtime automatically.
 *
 * Reliability invariant (rails):
 * - Pipeline boot is NOT a handler test. If boot fails, that is a rails failure
 *   (virtual server could not boot), not a failed handler test.
 * - Therefore: DO NOT mint/persist a HandlerTestDto for boot.
 *
 * Virtual-server construction (Approach 1):
 * - Build the target service SvcRuntime using shared envBootstrap (prod-shaped),
 *   then call the target service’s dist app factory using full CreateAppOptions.
 * - DO NOT pass “old-world” params into AppBase (envDto/envReloader); those may
 *   still exist in service CreateAppOptions for compatibility, but AppBase must
 *   source all config from rt.
 */

import * as path from "path";

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerContext as HandlerContextCtor } from "@nv/shared/http/handlers/HandlerContext";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { envBootstrap } from "@nv/shared/bootstrap/envBootstrap";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { SvcPosture } from "@nv/shared/runtime/SvcPosture";

import { IndexLoader } from "./IndexLoader";
import { StepIterator } from "./StepIterator";
import type { HandlerTestModuleLoader } from "./ScenarioRunner";
import type { TestRunWriter } from "./TestRunWriter";

export type IndexFile = {
  absolutePath: string;
  relativePath: string;
};

type Target = {
  serviceSlug: string;
  serviceVersion: number;
};

export class IndexIterator {
  public constructor(
    private readonly moduleLoader: HandlerTestModuleLoader // injected for ScenarioRunner use
  ) {}

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

    const loader = new IndexLoader();
    const stepIterator = new StepIterator(this.moduleLoader);

    for (let i = 0; i < input.indices.length; i++) {
      const index = input.indices[i];

      const ctx = this.buildPipelineContext({
        requestId: `${prefix}-${i}-${Date.now()}`,
        pipelineLabel: label,
        indexAbsolutePath: index.absolutePath,
        indexRelativePath: index.relativePath,
      });

      const target = this.deriveTargetFromIndex(index.relativePath);

      const log = ctx.get<any>("log");

      let targetApp: AppBase | undefined;
      let controller: any;
      let steps: any[] | undefined;

      try {
        // 1) Load the TARGET service app (dist-first), building a real virtual server (rt) via envBootstrap.
        targetApp = await this.loadTargetServiceApp({
          rootDir: input.rootDir,
          target,
          log,
        });

        // 2) Resolve controller + steps from index.ts using TARGET app (not test-runner app).
        const resolved = await loader.execute({
          indexAbsolutePath: index.absolutePath,
          ctx,
          app: targetApp,
        });

        controller = resolved.controller;
        steps = resolved.steps;

        // Fail-fast: loader must return an array of handler step instances.
        if (!Array.isArray(steps)) {
          const msg = [
            "IndexIterator: IndexLoader returned a non-array steps value.",
            `Index: ${index.relativePath}`,
            `Target: ${target.serviceSlug}@${target.serviceVersion}`,
            `Typeof(steps): ${typeof steps}`,
            "Ops: fix IndexLoader / pipeline index export shape so resolved.steps is a HandlerBase[] array.",
          ].join(" ");

          log?.error?.(
            {
              event: "index_loader_steps_not_array",
              index: index.relativePath,
              targetServiceSlug: target.serviceSlug,
              targetServiceVersion: target.serviceVersion,
              stepsType: typeof steps,
              hasSteps: !!steps,
              controller: controller?.constructor?.name,
            },
            msg
          );

          throw new Error(msg);
        }

        log?.info?.(
          {
            event: "index_loaded",
            index: index.relativePath,
            stepCount: steps.length,
            controller: controller?.constructor?.name,
            targetServiceSlug: target.serviceSlug,
            targetServiceVersion: target.serviceVersion,
            targetApp: (targetApp as any)?.constructor?.name,
          },
          "Pipeline index loaded"
        );

        // 3) Virtual-server runtime: seed onto pipeline ctx so scenario ctx can inherit it.
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
      } catch (err: any) {
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        // Rails failure: pipeline boot did not complete (virtual server could not boot).
        log?.error?.(
          {
            event: "pipeline_boot_failed",
            index: index.relativePath,
            targetServiceSlug: target.serviceSlug,
            targetServiceVersion: target.serviceVersion,
            errorMessage: msg,
          },
          "IndexIterator: pipeline boot failed (rails failure, not a handler test failure)"
        );

        throw err;
      }

      // From here on, targetApp/controller/steps/rt are guaranteed.
      await stepIterator.execute({
        ctx,
        controller: controller as any,
        steps: steps as any,
        indexRelativePath: index.relativePath,
        testRunId: input.testRunId,
        writer: input.writer,
        target,
        app: targetApp as AppBase,
      });
    }
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

  private extractPrimaryEnvDto(envBag: DtoBag<EnvServiceDto>): EnvServiceDto {
    const it = envBag.items();
    const first = it.next();
    const primary: EnvServiceDto | undefined = first.done
      ? undefined
      : first.value;

    if (!primary) {
      throw new Error(
        "BOOTSTRAP_ENV_BAG_EMPTY_AT_TEST_RUNNER: No EnvServiceDto in envBag after envBootstrap. " +
          "Ops: verify env-service has a config record for this service (env@slug@version)."
      );
    }

    return primary;
  }

  private adaptEnvReloader(
    envReloader: () => Promise<DtoBag<EnvServiceDto>>
  ): () => Promise<EnvServiceDto> {
    return async (): Promise<EnvServiceDto> => {
      const bag = await envReloader();
      const it = bag.items();
      const first = it.next();
      const primary: EnvServiceDto | undefined = first.done
        ? undefined
        : first.value;

      if (!primary) {
        throw new Error(
          "ENV_RELOADER_EMPTY_BAG_AT_TEST_RUNNER: envReloader returned an empty bag. " +
            "Ops: ensure the service’s EnvServiceDto config record still exists in env-service."
        );
      }

      return primary;
    };
  }

  /**
   * Approach 1:
   * - Build the target service SvcRuntime using envBootstrap (prod-shaped)
   * - Call the target service dist app factory with full CreateAppOptions
   *
   * Contract requirements for dist/app.js (template-driven):
   * - MUST export createAppBase(opts) for runner use (no HTTP listen).
   * - MUST export posture (or POSTURE) so runner can apply posture rails in envBootstrap.
   *
   * If either is missing, we fail-fast with concrete Ops guidance.
   */
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
          "Rationale: envBootstrap must enforce posture-derived boot rails to construct the virtual server (rt) correctly.",
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

    // Build a prod-shaped virtual server (rt) for the target service.
    const { envLabel, envBag, envReloader, rt } = await envBootstrap({
      slug: serviceSlug,
      version: serviceVersion,
      posture,
      // Optional: let envBootstrap pick its default log file; runner just surfaces errors.
    });

    const envDto = this.extractPrimaryEnvDto(envBag);
    const envReloaderForApp = this.adaptEnvReloader(envReloader);

    // Full CreateAppOptions for the target service.
    // NOTE: envDto/envReloader are legacy fields that may still exist in service options;
    // they MUST NOT be passed into AppBase ctor by the service (rt owns env).
    const opts = {
      slug: serviceSlug,
      version: serviceVersion,
      posture,
      envLabel, // convenience only (legacy); rt is the source of truth
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
          "Ops/Dev: ensure createAppBase returns an AppBase instance (booted via AppBase.bootAppBase).",
        ].join(" ")
      );
    }

    return candidate as AppBase;
  }
}
