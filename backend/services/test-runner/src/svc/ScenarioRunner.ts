// backend/services/test-runner/src/svc/ScenarioRunner.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - LDD-35 (Handler-level test-runner service)
 * - LDD-38 (Test Runner vNext Design)
 * - LDD-39 (StepIterator Micro-Contract — Revised, KISS)
 *
 * Purpose:
 * - Bridge between StepIterator and per-handler test modules.
 *
 * Key invariant:
 * - A “step” is an executable adapter that runs a handler in production shape:
 *     new Handler(scenarioCtx, controller).run()
 *   NOT “call protected execute()” and NOT “reuse a handler instance”.
 *
 * Rails:
 * - Scenario.expectedError MUST be reflected on scenario ctx as ctx["test.expectErrors"]
 *   so shared error helpers can downgrade expected-negative logs.
 */

import { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

export type ScenarioStep = {
  /**
   * Stable handler name for mapping to <handlerName>.test.js.
   * (Usually handler.getHandlerName()).
   */
  handlerName: string;

  /**
   * Execute the handler in prod shape against the provided scenario ctx.
   */
  execute: (scenarioCtx: HandlerContext) => Promise<void>;
};

export type ScenarioDeps = {
  step: ScenarioStep;
  controller: ControllerBase;
  app: AppBase;
  pipelineCtx: HandlerContext;

  makeScenarioCtx: (seed: {
    requestId: string;
    dtoType?: string;
    op?: string;
  }) => HandlerContext;

  target: { serviceSlug: string; serviceVersion: number };
};

export interface HandlerTestScenarioDef {
  id: string;
  name: string;
  expectedError: boolean;
  shortCircuitOnFail?: boolean;
  run: (deps: ScenarioDeps) => Promise<HandlerTestResult>;
}

export interface HandlerTestModule {
  getScenarios: (deps: ScenarioDeps) => Promise<HandlerTestScenarioDef[]>;
}

export interface HandlerTestModuleLoader {
  loadFor(dto: HandlerTestDto): Promise<HandlerTestModule | undefined>;
}

export interface ScenarioRunnerLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface ScenarioRunnerDeps {
  loader: HandlerTestModuleLoader;
  logger?: ScenarioRunnerLogger;
}

export class ScenarioRunner {
  private readonly loader: HandlerTestModuleLoader;
  private readonly log?: ScenarioRunnerLogger;

  public constructor(deps: ScenarioRunnerDeps) {
    this.loader = deps.loader;
    this.log = deps.logger;
  }

  public async run(
    dto: HandlerTestDto,
    deps: ScenarioDeps
  ): Promise<HandlerTestDto> {
    this.log?.debug("ScenarioRunner.start", {
      targetServiceSlug: dto.getTargetServiceSlug(),
      targetServiceVersion: dto.getTargetServiceVersion(),
      indexRelativePath: dto.getIndexRelativePath(),
      handlerName: dto.getHandlerName(),
    });

    const module = await this.loader.loadFor(dto);

    if (!module) {
      this.log?.info("ScenarioRunner.noModule", {
        targetServiceSlug: dto.getTargetServiceSlug(),
        targetServiceVersion: dto.getTargetServiceVersion(),
        indexRelativePath: dto.getIndexRelativePath(),
        handlerName: dto.getHandlerName(),
      });
      return dto;
    }

    let scenarios: HandlerTestScenarioDef[];
    try {
      if (typeof module.getScenarios !== "function") {
        throw new Error("Test module missing getScenarios(deps)");
      }
      scenarios = await module.getScenarios(deps);
    } catch (err: any) {
      await this.recordModuleErrorScenario(dto, err);
      dto.finalizeFromScenarios();
      return dto;
    }

    if (!Array.isArray(scenarios) || scenarios.length === 0) {
      this.log?.warn("ScenarioRunner.emptyScenarioList", {
        targetServiceSlug: dto.getTargetServiceSlug(),
        targetServiceVersion: dto.getTargetServiceVersion(),
        indexRelativePath: dto.getIndexRelativePath(),
        handlerName: dto.getHandlerName(),
      });
      dto.finalizeFromScenarios();
      return dto;
    }

    for (const scenario of scenarios) {
      const shortCircuitOnFail =
        scenario.shortCircuitOnFail === undefined
          ? true
          : scenario.shortCircuitOnFail;

      const beforeCount = dto.getScenarios().length;

      await this.runOneScenario(dto, scenario, deps);

      const scenariosAfter = dto.getScenarios();
      const last =
        scenariosAfter.length > 0
          ? scenariosAfter[scenariosAfter.length - 1]
          : undefined;

      const failed = last?.status === "Failed";

      if (failed && shortCircuitOnFail) {
        this.log?.info("ScenarioRunner.shortCircuit", {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          handlerName: dto.getHandlerName(),
        });
        break;
      }

      if (scenariosAfter.length === beforeCount) {
        this.log?.warn("ScenarioRunner.noScenarioRecorded", {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          handlerName: dto.getHandlerName(),
        });
      }
    }

    dto.finalizeFromScenarios();

    this.log?.debug("ScenarioRunner.complete", {
      handlerName: dto.getHandlerName(),
      status: dto.getStatus(),
      scenarioCount: dto.getScenarios().length,
    });

    return dto;
  }

  private async runOneScenario(
    dto: HandlerTestDto,
    scenario: HandlerTestScenarioDef,
    deps: ScenarioDeps
  ): Promise<void> {
    // Rails: automatically seed ctx["test.expectErrors"] for this scenario.
    // This avoids forcing every test module to remember to set it.
    const depsForScenario: ScenarioDeps = {
      ...deps,
      makeScenarioCtx: (seed) => {
        const sc = deps.makeScenarioCtx(seed);
        try {
          sc.set("test.expectErrors", scenario.expectedError === true);
        } catch {}
        return sc;
      },
    };

    await dto.runScenario(
      scenario.name,
      async () => {
        const result = await this.safeScenarioRun(scenario, depsForScenario);
        const isPassed = result.outcome === "passed";

        return {
          status: isPassed ? "Passed" : "Failed",
          details: result,
        };
      },
      { rethrowOnRailError: false }
    );
  }

  private async safeScenarioRun(
    scenario: HandlerTestScenarioDef,
    deps: ScenarioDeps
  ): Promise<HandlerTestResult> {
    try {
      const result: HandlerTestResult = await scenario.run(deps);

      const testId =
        (result as any).testId && typeof (result as any).testId === "string"
          ? (result as any).testId
          : scenario.id;

      const name =
        typeof result.name === "string" && result.name.trim()
          ? result.name
          : scenario.name;

      return {
        testId,
        name,
        outcome: result.outcome,
        expectedError: result.expectedError,
        assertionCount: result.assertionCount ?? 0,
        failedAssertions: Array.isArray(result.failedAssertions)
          ? result.failedAssertions
          : [],
        errorMessage: result.errorMessage,
        durationMs: result.durationMs ?? 0,
        railsVerdict: result.railsVerdict,
        railsStatus: result.railsStatus,
        railsHandlerStatus: result.railsHandlerStatus,
        railsResponseStatus: result.railsResponseStatus,
      };
    } catch (err: any) {
      this.log?.error("ScenarioRunner.scenarioException", {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        errorName: err?.name,
        errorMessage: err?.message,
      });

      const message =
        err instanceof Error ? err.message : String(err ?? "unknown error");

      return {
        testId: scenario.id,
        name: scenario.name,
        outcome: "failed",
        expectedError: false,
        assertionCount: 0,
        failedAssertions: [],
        errorMessage: message,
        durationMs: 0,
        railsVerdict: "test_bug",
        railsStatus: undefined,
        railsHandlerStatus: undefined,
        railsResponseStatus: undefined,
      };
    }
  }

  private async recordModuleErrorScenario(
    dto: HandlerTestDto,
    err: unknown
  ): Promise<void> {
    this.log?.error("ScenarioRunner.moduleRailError", {
      targetServiceSlug: dto.getTargetServiceSlug(),
      targetServiceVersion: dto.getTargetServiceVersion(),
      indexRelativePath: dto.getIndexRelativePath(),
      handlerName: dto.getHandlerName(),
      errorName: (err as any)?.name,
      errorMessage: (err as any)?.message,
    });

    const message =
      err instanceof Error ? err.message : String(err ?? "unknown error");

    await dto.runScenario(
      "test-module: getScenarios(deps) failure",
      async () => {
        const synthetic: HandlerTestResult = {
          testId: "module-error",
          name: "test-module: getScenarios(deps) failure",
          outcome: "failed",
          expectedError: false,
          assertionCount: 0,
          failedAssertions: [],
          errorMessage: message,
          durationMs: 0,
          railsVerdict: "test_bug",
          railsStatus: undefined,
          railsHandlerStatus: undefined,
          railsResponseStatus: undefined,
        };

        return { status: "Failed", details: synthetic };
      },
      { rethrowOnRailError: false }
    );
  }
}
