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
 * - Given ONE HandlerTestDto (one handler under test), load its test module,
 *   execute scenarios sequentially, and record the results on the DTO using
 *   HandlerTestDto.runScenario(...). Then derive the final test status via
 *   HandlerTestDto.finalizeFromScenarios().
 *
 * Invariants:
 * - ScenarioRunner is the ONLY place that:
 *   - loops test scenarios for a handler,
 *   - applies short-circuit rules (“happy first, abort on fail”),
 *   - maps scenario results into DTO’s scenario shape.
 * - Test modules:
 *   - ONLY declare scenarios and provide run() functions.
 *   - NEVER touch HandlerTestDto directly.
 * - HandlerTestDto:
 *   - Stores header and scenarios.
 *   - Provides runScenario() and finalizeFromScenarios().
 *   - Knows NOTHING about how many scenarios exist or how they’re orchestrated.
 */

import { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";

export type HandlerTestOutcome = "passed" | "failed" | "skipped" | "rail-error";

export interface HandlerTestScenarioResult {
  id: string; // scenario key ("happy", "missing_email", etc.)
  name: string; // human-readable label
  outcome: HandlerTestOutcome;
  expectedError: boolean; // true if this is a negative test
  message?: string; // short summary
  details?: unknown; // assertion details, rails info, etc.
}

/**
 * How ScenarioRunner sees a scenario definition from the test module.
 */
export interface HandlerTestScenarioDef {
  id: string;
  name: string;
  expectedError: boolean;
  shortCircuitOnFail?: boolean; // default true if undefined
  run: () => Promise<HandlerTestScenarioResult>;
}

/**
 * Contract for a per-handler test module (e.g. code.build.userId.test.ts).
 */
export interface HandlerTestModule {
  getScenarios(): Promise<HandlerTestScenarioDef[]>;
}

/**
 * Loader that knows how to find the right test module for a given HandlerTestDto.
 * (Path and import mechanics live outside ScenarioRunner.)
 */
export interface HandlerTestModuleLoader {
  loadFor(dto: HandlerTestDto): Promise<HandlerTestModule | undefined>;
}

/**
 * Minimal logger abstraction so we can plug existing logging without coupling.
 */
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

  /**
   * Run all scenarios for the handler described by `dto`.
   *
   * - If no test module is found → dto is returned unchanged.
   * - If getScenarios() fails → records a rail-error scenario and returns.
   * - Otherwise:
   *   - runs each scenario in order,
   *   - records results via dto.runScenario(...),
   *   - applies short-circuit based on scenario.shortCircuitOnFail,
   *   - calls dto.finalizeFromScenarios() to compute final status.
   */
  public async run(dto: HandlerTestDto): Promise<HandlerTestDto> {
    this.log?.debug("ScenarioRunner.start", {
      targetServiceSlug: dto.getTargetServiceSlug(),
      targetServiceVersion: dto.getTargetServiceVersion(),
      indexRelativePath: dto.getIndexRelativePath(),
      pipelineName: dto.getPipelineName(),
      handlerName: dto.getHandlerName(),
    });

    const module = await this.loader.loadFor(dto);

    if (!module) {
      // No tests for this handler — nothing to do.
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
      scenarios = await module.getScenarios();
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
      // No scenarios means we leave dto.scenarios[] as-is; status will be
      // determined elsewhere (often TestError if nothing ever recorded).
      dto.finalizeFromScenarios();
      return dto;
    }

    for (const scenario of scenarios) {
      const shortCircuitOnFail =
        scenario.shortCircuitOnFail === undefined
          ? true
          : scenario.shortCircuitOnFail;

      const beforeCount = dto.getScenarios().length;

      await this.runOneScenario(dto, scenario);

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

      // If no new scenario was appended, log that as a rail smell.
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

  /**
   * Run a single scenario definition, recording the result on the DTO using
   * HandlerTestDto.runScenario(). All mapping from the richer
   * HandlerTestScenarioResult into the DTO's ScenarioResult shape is done here.
   */
  private async runOneScenario(
    dto: HandlerTestDto,
    scenario: HandlerTestScenarioDef
  ): Promise<void> {
    await dto.runScenario(
      scenario.name,
      async () => {
        const result = await this.safeScenarioRun(scenario);

        // Map HandlerTestScenarioResult → ScenarioResult (DTO contract).
        // We treat ONLY "passed" as Passed; everything else (failed/skipped/rail-error)
        // is marked as Failed at the DTO level. The richer outcome is preserved in details.
        const isPassed = result.outcome === "passed";

        return {
          status: isPassed ? "Passed" : "Failed",
          details: {
            scenarioId: result.id,
            scenarioName: result.name,
            outcome: result.outcome,
            expectedError: result.expectedError,
            message: result.message,
            inner: result.details,
          },
        };
      },
      {
        // We already catch exceptions in safeScenarioRun(), so we never want
        // runScenario to rethrow. It should just record the scenario.
        rethrowOnRailError: false,
      }
    );
  }

  /**
   * Wraps scenario.run() so any thrown error becomes a rail-error result
   * instead of killing the whole handler test.
   */
  private async safeScenarioRun(
    scenario: HandlerTestScenarioDef
  ): Promise<HandlerTestScenarioResult> {
    try {
      const result = await scenario.run();

      // Ensure id/name continuity in case test forgot to set them.
      return {
        id: result.id || scenario.id,
        name: result.name || scenario.name,
        outcome: result.outcome,
        expectedError: result.expectedError,
        message: result.message,
        details: result.details,
      };
    } catch (err: any) {
      this.log?.error("ScenarioRunner.scenarioException", {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        handlerName: undefined,
        errorName: err?.name,
        errorMessage: err?.message,
      });

      return {
        id: scenario.id,
        name: scenario.name,
        outcome: "rail-error",
        expectedError: false,
        message: "Scenario threw unexpectedly during run()",
        details: {
          errorName: err?.name,
          errorMessage: err?.message,
          errorStack: err?.stack,
        },
      };
    }
  }

  /**
   * If getScenarios() itself fails, record a synthetic rail-error scenario so
   * the DTO still reflects something went wrong, instead of silently succeeding.
   */
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

    await dto.runScenario(
      "test-module: getScenarios() failure",
      async () => ({
        status: "Failed",
        details: {
          scenarioId: "module-error",
          scenarioName: "test-module: getScenarios() failure",
          outcome: "rail-error" as HandlerTestOutcome,
          expectedError: false,
          message: "Test module failed to provide scenarios",
          inner: {
            errorName: (err as any)?.name,
            errorMessage: (err as any)?.message,
            errorStack: (err as any)?.stack,
          },
        },
      }),
      { rethrowOnRailError: false }
    );
  }
}
