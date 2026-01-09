// backend/services/test-runner/src/svc/ScenarioRunner.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0099 (Strict missing-test semantics)
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
 * ADR-0094 rails:
 * - No expectErrors anywhere.
 * - No ALS fallbacks for test semantics.
 * - No log-level gymnastics in helpers.
 * - ERROR logs mean runner/test infrastructure failure only (outcomeCode=5).
 *
 * ADR-0099 strictness:
 * - If a pipeline manifest names a test (expectedTestName !== "skipped"),
 *   then missing module / empty scenarios is a TEST FAILURE (drift), not Skipped.
 *
 * Expected test name semantics:
 * - "skipped": explicit opt-out
 * - "default": derive from handlerName (=> "<handlerName>.test.js")
 * - otherwise: explicit override basename (=> "<expectedTestName>.test.js")
 */

import { HandlerTestDto } from "@nv/shared/dto/db.handler-test.dto";

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioOutcome } from "@nv/shared/testing/TestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";

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

  /**
   * ADR-0099: expected test module name for this handler step.
   * - If "skipped": test is intentionally absent.
   * - If "default": derived from handlerName.
   * - Otherwise: explicit override (basename).
   *
   * NOTE:
   * - StepIterator MUST pass this from stepDefs[i].expectedTestName (or aligned plan).
   */
  expectedTestName?: string;
};

export interface HandlerTestScenarioDef {
  id: string;
  name: string;

  /**
   * If omitted, defaults to true.
   * Runner will ALSO hard-abort on outcomeCode=5 (infra failure) regardless of this flag.
   */
  shortCircuitOnFail?: boolean;

  /**
   * ADR-0094 contract:
   * - Scenario.run returns a TestScenarioStatus (already seeded and finalized via shared finalizer).
   * - Runner consumes status only; runner does not infer semantics.
   */
  run: (deps: ScenarioDeps) => Promise<TestScenarioStatus>;
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
    const rawExpected = String(deps.expectedTestName ?? "").trim();

    // ADR-0099: explicit opt-out is allowed.
    if (rawExpected === "skipped") {
      this.log?.info("ScenarioRunner.explicitSkipped", {
        handlerName: dto.getHandlerName(),
        expectedTestName: rawExpected,
      });
      return dto;
    }

    const resolvedExpectedTestName = this.resolveExpectedTestName({
      rawExpectedTestName: rawExpected,
      handlerName: dto.getHandlerName() || deps.step.handlerName,
    });

    this.log?.debug("ScenarioRunner.start", {
      targetServiceSlug: dto.getTargetServiceSlug(),
      targetServiceVersion: dto.getTargetServiceVersion(),
      indexRelativePath: dto.getIndexRelativePath(),
      handlerName: dto.getHandlerName(),
      expectedTestName: resolvedExpectedTestName,
      expectedTestFile: `${resolvedExpectedTestName}.test.js`,
    });

    const module = await this.loader.loadFor(dto);

    if (!module) {
      // ADR-0099: missing module when a test was expected is DRIFT => FAIL.
      await this.recordMissingTestScenario(dto, deps, {
        reason: "MISSING_TEST_MODULE",
        expectedTestName: resolvedExpectedTestName,
      });
      dto.finalizeFromScenarios();
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
      // ADR-0099: empty scenario list when test is expected is DRIFT => FAIL.
      await this.recordMissingTestScenario(dto, deps, {
        reason: "EMPTY_SCENARIO_LIST",
        expectedTestName: resolvedExpectedTestName,
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

      const outcome = await this.runOneScenario(dto, scenario, deps);

      const isInfraAbort = outcome.code === 5;
      const isScenarioFail = outcome.color === "red";

      if (isInfraAbort) {
        // ADR-0094: outcome 5 => ERROR + abort immediately.
        this.log?.error("ScenarioRunner.abortOnInfraFailure", {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          handlerName: dto.getHandlerName(),
          outcomeCode: outcome.code,
        });
        break;
      }

      if (isScenarioFail && shortCircuitOnFail) {
        // ADR-0094: non-infra failures are INFO (never WARN/ERROR).
        this.log?.info("ScenarioRunner.shortCircuit", {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          handlerName: dto.getHandlerName(),
          outcomeCode: outcome.code,
        });
        break;
      }

      const scenariosAfter = dto.getScenarios();
      if (scenariosAfter.length === beforeCount) {
        // This indicates a runner recording bug, but do NOT throw; record is the source of truth.
        this.log?.error("ScenarioRunner.noScenarioRecorded", {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          handlerName: dto.getHandlerName(),
        });
        break;
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

  private resolveExpectedTestName(input: {
    rawExpectedTestName: string;
    handlerName: string;
  }): string {
    const hn = String(input.handlerName ?? "").trim();
    const raw = String(input.rawExpectedTestName ?? "").trim();

    // If plan forgot to supply anything, treat as derived-from-handler (same behavior as "default").
    if (!raw || raw === "default") {
      return hn || "unknown-handler";
    }

    // "skipped" is handled earlier; treat it as a derived name here only if someone calls us incorrectly.
    if (raw === "skipped") {
      return "skipped";
    }

    return raw;
  }

  private async runOneScenario(
    dto: HandlerTestDto,
    scenario: HandlerTestScenarioDef,
    deps: ScenarioDeps
  ): Promise<TestScenarioOutcome> {
    await dto.runScenario(
      scenario.name,
      async () => {
        const scenarioStatus = await this.safeScenarioRunStatus(scenario, deps);

        const outcome = scenarioStatus.outcome() ?? {
          code: 5,
          color: "red",
          logLevel: "error",
          abortPipeline: true,
        };

        // Record a stable DTO scenario entry.
        // NOTE: dto.finalizeFromScenarios() currently expects “Passed/Failed”.
        const passed = outcome.color === "green";

        return {
          status: passed ? "Passed" : "Failed",
          details: {
            scenarioId: scenarioStatus.scenarioId(),
            scenarioName: scenarioStatus.scenarioName(),
            expected: scenarioStatus.expected(),
            outcome,
            rails: scenarioStatus.rails(),
            caught: scenarioStatus.caught(),
            notes: scenarioStatus.notes(),
          },
        };
      },
      { rethrowOnRailError: false }
    );

    // Return the recorded outcome for runner control flow.
    const last = dto.getScenarios().length
      ? dto.getScenarios()[dto.getScenarios().length - 1]
      : undefined;

    const recordedOutcome = (last as any)?.details?.outcome as
      | TestScenarioOutcome
      | undefined;
    return (
      recordedOutcome ?? {
        code: 5,
        color: "red",
        logLevel: "error",
        abortPipeline: true,
      }
    );
  }

  private isScenarioStatusLike(v: unknown): v is TestScenarioStatus {
    const anyV = v as any;
    return (
      !!anyV &&
      typeof anyV.isFinalized === "function" &&
      typeof anyV.outcome === "function" &&
      typeof anyV.scenarioId === "function" &&
      typeof anyV.scenarioName === "function" &&
      typeof anyV.expected === "function"
    );
  }

  private async safeScenarioRunStatus(
    scenario: HandlerTestScenarioDef,
    deps: ScenarioDeps
  ): Promise<TestScenarioStatus> {
    try {
      const raw = await scenario.run(deps);

      // ADR-0094: Scenario.run MUST return a real TestScenarioStatus instance.
      // If it returns a POJO (or anything else), treat as infrastructure failure (outcomeCode=5).
      if (!this.isScenarioStatusLike(raw)) {
        const scenarioStatus = createTestScenarioStatus({
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          expected: "success",
        });

        const err = new TypeError(
          "Scenario.run returned a non-TestScenarioStatus value (missing methods)."
        );
        (err as any).returnedType = typeof raw;
        (err as any).returnedKeys =
          raw && typeof raw === "object" ? Object.keys(raw as any) : undefined;

        scenarioStatus.recordOuterCatch(err);
        TestScenarioFinalizer.finalize({
          status: scenarioStatus,
          ctx: deps.pipelineCtx as any,
        });

        this.log?.error("ScenarioRunner.scenarioReturnedNonStatus", {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          handlerName: deps.step.handlerName,
          returnedType: (err as any).returnedType,
          returnedKeys: (err as any).returnedKeys,
        });

        return scenarioStatus;
      }

      const scenarioStatus = raw;

      // Ensure it was finalized; if not, finalize with best-effort rails snapshot from pipelineCtx.
      // (Scenarios SHOULD finalize using their own scenario ctx; this is a guardrail.)
      if (!scenarioStatus.isFinalized()) {
        TestScenarioFinalizer.finalize({
          status: scenarioStatus,
          ctx: deps.pipelineCtx as any,
        });
      }

      // ADR-0094: runner logs only infra failures as ERROR.
      // Non-infra failures are INFO. Success is DEBUG.
      const outcome = scenarioStatus.outcome();
      if (outcome) {
        if (outcome.code === 5) {
          this.log?.error("ScenarioRunner.infraFailure", {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            handlerName: deps.step.handlerName,
            outcomeCode: outcome.code,
            caught: scenarioStatus.caught(),
          });
        } else if (outcome.color === "red") {
          this.log?.info("ScenarioRunner.scenarioFailed", {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            handlerName: deps.step.handlerName,
            outcomeCode: outcome.code,
          });
        } else {
          this.log?.debug("ScenarioRunner.scenarioPassed", {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            handlerName: deps.step.handlerName,
            outcomeCode: outcome.code,
          });
        }
      }

      return scenarioStatus;
    } catch (err: any) {
      // Any thrown exception escaping scenario.run is infrastructure failure (ADR-0094 outcome 5).
      const scenarioStatus = createTestScenarioStatus({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        expected: "success",
      });

      scenarioStatus.recordOuterCatch(err);
      TestScenarioFinalizer.finalize({
        status: scenarioStatus,
        ctx: deps.pipelineCtx as any,
      });

      this.log?.error("ScenarioRunner.scenarioRunThrew", {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        handlerName: deps.step.handlerName,
        errorName: err?.name,
        errorMessage: err?.message,
      });

      return scenarioStatus;
    }
  }

  private async recordMissingTestScenario(
    dto: HandlerTestDto,
    deps: ScenarioDeps,
    input: {
      reason: "MISSING_TEST_MODULE" | "EMPTY_SCENARIO_LIST";
      expectedTestName: string;
    }
  ): Promise<void> {
    // Non-infra “drift” failure: do NOT use outcomeCode=5.
    const outcome: TestScenarioOutcome = {
      code: 1,
      color: "red",
      logLevel: "info",
      abortPipeline: false,
    };

    const scenarioId =
      input.reason === "MISSING_TEST_MODULE"
        ? "missing-test-module"
        : "empty-scenario-list";

    const scenarioName =
      input.reason === "MISSING_TEST_MODULE"
        ? `missing test module: ${input.expectedTestName}`
        : `empty scenario list: ${input.expectedTestName}`;

    this.log?.info("ScenarioRunner.expectedTestMissing", {
      reason: input.reason,
      expectedTestName: input.expectedTestName,
      expectedTestFile: `${input.expectedTestName}.test.js`,
      handlerName: dto.getHandlerName(),
      indexRelativePath: dto.getIndexRelativePath(),
      targetServiceSlug: dto.getTargetServiceSlug(),
      targetServiceVersion: dto.getTargetServiceVersion(),
    });

    const scenarioStatus = createTestScenarioStatus({
      scenarioId,
      scenarioName,
      expected: "success",
    });

    const msg = [
      input.reason,
      `expectedTestName="${input.expectedTestName}"`,
      `expectedTestFile="${input.expectedTestName}.test.js"`,
      `handler="${dto.getHandlerName()}"`,
      `index="${dto.getIndexRelativePath()}"`,
      "Dev: pipeline plan expected a test that was not loadable/executable. Fix the test module path/name or set expectedTestName='skipped' explicitly.",
    ].join(" | ");

    try {
      (scenarioStatus as any).recordAssertionFailure?.(msg);
    } catch {
      try {
        (scenarioStatus as any).addNote?.(msg);
      } catch {}
    }

    TestScenarioFinalizer.finalize({ status: scenarioStatus });

    await dto.runScenario(
      scenarioName,
      async () => {
        return {
          status: "Failed",
          details: {
            scenarioId: scenarioStatus.scenarioId(),
            scenarioName: scenarioStatus.scenarioName(),
            expected: scenarioStatus.expected(),
            outcome,
            rails: scenarioStatus.rails(),
            caught: scenarioStatus.caught(),
            notes: scenarioStatus.notes(),
          },
        };
      },
      { rethrowOnRailError: false }
    );
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

    const scenarioStatus = createTestScenarioStatus({
      scenarioId: "module-error",
      scenarioName: "test-module: getScenarios(deps) failure",
      expected: "success",
    });

    scenarioStatus.recordOuterCatch(err);
    TestScenarioFinalizer.finalize({ status: scenarioStatus });

    await dto.runScenario(
      "test-module: getScenarios(deps) failure",
      async () => {
        const outcome = scenarioStatus.outcome() ?? {
          code: 5,
          color: "red",
          logLevel: "error",
          abortPipeline: true,
        };

        return {
          status: outcome.color === "green" ? "Passed" : "Failed",
          details: {
            scenarioId: scenarioStatus.scenarioId(),
            scenarioName: scenarioStatus.scenarioName(),
            expected: scenarioStatus.expected(),
            outcome,
            rails: scenarioStatus.rails(),
            caught: scenarioStatus.caught(),
            notes: scenarioStatus.notes(),
          },
        };
      },
      { rethrowOnRailError: false }
    );
  }
}
