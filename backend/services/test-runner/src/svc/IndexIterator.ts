// backend/services/test-runner/src/svc/IndexIterator.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - LDD-38/39 (StepIterator Micro-Contract + VNext Orchestration)
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
 * Reliability invariant (writer):
 * - Mint a HandlerTestDto EARLY for pipeline boot (“code.pipelineBoot”).
 * - Always finalize the record in a finally block so failures are persisted even
 *   when boot dies before StepIterator starts.
 */

import * as path from "path";

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerContext as HandlerContextCtor } from "@nv/shared/http/handlers/HandlerContext";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { HandlerTestDtoRegistry } from "@nv/shared/dto/registry/handler-test.dtoRegistry";
import type { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";

import { IndexLoader } from "./IndexLoader";
import { StepIterator } from "./StepIterator";
import type {
  HandlerTestRecord,
  TestHandlerTerminalStatus,
  TestRunWriter,
} from "./TestRunWriter";
import type { HandlerTestModuleLoader } from "./ScenarioRunner";

export type IndexFile = {
  absolutePath: string;
  relativePath: string;
};

export class IndexIterator {
  private readonly handlerTestRegistry = new HandlerTestDtoRegistry();

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

      // ─────────────────────────────────────────────────────────────
      // Pipeline-boot record: persisted even if boot explodes early.
      // ─────────────────────────────────────────────────────────────
      const bootDto: HandlerTestDto =
        this.handlerTestRegistry.newHandlerTestDto();
      bootDto.ensureId();

      bootDto.setIndexRelativePathOnce(index.relativePath);
      bootDto.setPipelineNameOnce(label);

      bootDto.setHandlerNameOnce("code.pipelineBoot");
      bootDto.setHandlerPurposeOnce(
        "Load target AppBase, load pipeline index (controller+steps), and seed SvcRuntime onto pipeline ctx."
      );

      bootDto.setTargetServiceSlugOnce(target.serviceSlug);
      bootDto.setTargetServiceVersionOnce(target.serviceVersion);

      bootDto.setRequestId(ctx.get<string>("requestId"));
      bootDto.markStarted();

      // Freeze write-once header now that it has been seeded.
      bootDto.freezeWriteOnce();

      const bootRecord: HandlerTestRecord = {
        dto: bootDto,
        testRunId: input.testRunId,
        stepIndex: -1,
        stepCount: -1,
        indexRelativePath: index.relativePath,
        handlerName: "code.pipelineBoot",
        targetServiceSlug: target.serviceSlug,
        targetServiceVersion: target.serviceVersion,
        rawResult: null,
      };

      let targetApp: AppBase | undefined;
      let controller: any;
      let steps: any[] | undefined;

      try {
        await input.writer.startHandlerTest(bootRecord);

        // Record an explicit boot scenario so finalizeFromScenarios derives a real status.
        await bootDto.runScenario(
          "pipeline boot",
          async () => {
            // 1) Load the TARGET service app (dist-first).
            targetApp = await this.loadTargetServiceApp({
              rootDir: input.rootDir,
              serviceSlug: target.serviceSlug,
              serviceVersion: target.serviceVersion,
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

            return {
              status: "Passed" as const,
              details: {
                event: "pipeline_boot_ok",
                indexRelativePath: index.relativePath,
                targetServiceSlug: target.serviceSlug,
                targetServiceVersion: target.serviceVersion,
              },
            };
          },
          { rethrowOnRailError: false }
        );
      } catch (err: any) {
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");

        // Ensure a failure scenario is persisted, but do NOT let it suppress the throw.
        try {
          await bootDto.runScenario(
            "pipeline boot failure",
            async () => {
              // Throwing here records the scenario as Failed; we swallow so we can finalize+write.
              throw err;
            },
            { rethrowOnRailError: false }
          );
        } catch {
          // runScenario is configured to swallow; this catch is purely defensive.
        }

        bootDto.setNotes(msg);

        log?.error?.(
          {
            event: "pipeline_boot_failed",
            index: index.relativePath,
            targetServiceSlug: target.serviceSlug,
            targetServiceVersion: target.serviceVersion,
            errorMessage: msg,
          },
          "IndexIterator: pipeline boot failed"
        );

        // Re-throw after we persist the boot record in finally.
        throw err;
      } finally {
        // Always finalize and persist the boot DTO, even when boot fails.
        try {
          if (!bootDto.getFinishedAt()) {
            bootDto.setFinishedAt(new Date().toISOString());
          }

          // Derive status from scenarios (single truth).
          bootDto.finalizeFromScenarios();

          bootRecord.terminalStatus = this.mapTerminalStatus(
            bootDto.getStatus()
          );

          // Include errorMessage/errorStack if the first failed scenario captured it.
          const scenarios = bootDto.getScenarios();
          const bad = Array.isArray(scenarios)
            ? scenarios.find((s: any) => s && s.status === "Failed")
            : undefined;

          if (bad) {
            bootRecord.errorMessage =
              typeof bad.errorMessage === "string"
                ? bad.errorMessage
                : undefined;
            bootRecord.errorStack =
              typeof bad.errorStack === "string" ? bad.errorStack : undefined;
          }

          await input.writer.finalizeHandlerTest(bootRecord);
        } catch (finalizeErr: any) {
          const msg =
            finalizeErr instanceof Error
              ? finalizeErr.message
              : String(finalizeErr ?? "unknown error");

          log?.error?.(
            {
              event: "pipeline_boot_record_finalize_failed",
              index: index.relativePath,
              targetServiceSlug: target.serviceSlug,
              targetServiceVersion: target.serviceVersion,
              errorMessage: msg,
            },
            "IndexIterator: failed to finalize pipeline-boot test record"
          );

          // At this point we cannot safely recover; surface the error.
          throw finalizeErr;
        }
      }

      // If boot failed, we threw above (after persisting boot record).
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

  private mapTerminalStatus(status: string): TestHandlerTerminalStatus {
    switch (status) {
      case "Passed":
        return "Passed";
      case "Failed":
        return "Failed";
      case "Skipped":
        return "Skipped";
      case "Started":
      case "TestError":
      default:
        return "TestError";
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

  private deriveTargetFromIndex(indexRelativePath: string): {
    serviceSlug: string;
    serviceVersion: number;
  } {
    const match = indexRelativePath.match(/backend\/services\/([^/]+)\//);
    const slug = match?.[1] ?? "unknown";

    return {
      serviceSlug: slug,
      serviceVersion: 1,
    };
  }

  /**
   * Dist-first target App loader.
   *
   * Key addition:
   * - When calling app factories, ALWAYS pass minimal identity:
   *     { slug, version }
   *   because many service apps require it during construction.
   */
  private async loadTargetServiceApp(input: {
    rootDir: string;
    serviceSlug: string;
    serviceVersion: number;
  }): Promise<AppBase> {
    const { rootDir, serviceSlug, serviceVersion } = input;

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

    const identity = { slug: serviceSlug, version: serviceVersion };

    let candidate: any;

    // 1) createAppBase(opts) + createApp(appBase)
    if (
      typeof mod?.createAppBase === "function" &&
      typeof mod?.createApp === "function"
    ) {
      const base = await Promise.resolve(mod.createAppBase(identity));
      candidate = mod.createApp(base);
      candidate = await Promise.resolve(candidate);
    }

    // 2) createApp(opts)
    if (!candidate && typeof mod?.createApp === "function") {
      candidate = await Promise.resolve(mod.createApp(identity));
    }

    // 3) default factory: default(opts)
    if (!candidate && typeof mod?.default === "function") {
      candidate = await Promise.resolve(mod.default(identity));
    }

    // 4) default instance
    if (!candidate && mod?.default && typeof mod.default === "object") {
      candidate = mod.default;
    }

    // 5) named instance
    if (!candidate && mod?.app) {
      candidate = mod.app;
    }

    if (!candidate) {
      throw new Error(
        `IndexIterator.loadTargetServiceApp: "${appJs}" did not export a supported app factory/instance`
      );
    }

    if (typeof candidate.getLogger !== "function") {
      const exportedKeys = mod ? Object.keys(mod).sort().join(",") : "";
      const ctorName = candidate?.constructor?.name ?? typeof candidate;

      throw new Error(
        [
          "IndexIterator.loadTargetServiceApp: loaded target app does not implement getLogger().",
          `Target: ${serviceSlug}`,
          `Module: ${appJs}`,
          `Candidate: ${ctorName}`,
          `Exports: [${exportedKeys}]`,
          "Ops: ensure dist/app.js returns a real AppBase from createAppBase(opts)+createApp(base), createApp(opts), or default(opts).",
        ].join(" ")
      );
    }

    return candidate as AppBase;
  }
}
