// backend/services/shared/src/http/handlers/HandlerBase.ts
/**
 * Docs:
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Hydration + Failure Propagation)
 * - ADR-0049 (DTO Registry & Wire Discrimination)
 * - ADR-0058 (HandlerBase.getVar — Strict Env Accessor)
 * - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Abstract base for handlers:
 *   • DI of HandlerContext + ControllerBase (required)
 *   • Access to App, Registry, Logger via controller getters
 *   • Short-circuit on prior failure
 *   • Standardized instrumentation via bound logger
 *   • Thin wrappers over env + error helpers
 *   • Optional per-handler runTest() hook for test-runner
 *
 * Invariants:
 * - Controllers MUST pass `this` into handler constructors.
 * - No reading plumbing from ctx (no ctx.get('app'), etc).
 * - Env reads go through controller.getSvcEnv().getVar() via helpers.
 * - HandlerBase.runTest() default returns undefined (no test).
 */

import { HandlerContext } from "./HandlerContext";
import { getLogger, type IBoundLogger } from "../../logger/Logger";
import type { AppBase } from "../../base/app/AppBase";
import type { IDtoRegistry } from "../../registry/RegistryBase";
import type { ControllerBase } from "../../base/controller/ControllerBase";
import {
  getEnvVarFromSvcEnv,
  resolveMongoConfigWithDbState,
} from "./handlerBaseExt/envHelpers";
import {
  logAndAttachHandlerError,
  type NvHandlerError,
  type FailWithErrorInput,
} from "./handlerBaseExt/errorHelpers";

import type { HandlerTestBase } from "./testing/HandlerTestBase";
import type { HandlerTestResult } from "./testing/HandlerTestBase";

// Re-export NvHandlerError so existing imports from HandlerBase remain valid.
export type { NvHandlerError } from "./handlerBaseExt/errorHelpers";

export abstract class HandlerBase {
  protected readonly ctx: HandlerContext;
  protected readonly log: IBoundLogger;

  /** Available to all derived handlers */
  protected readonly controller: ControllerBase;
  protected readonly app: AppBase;
  protected readonly registry: IDtoRegistry;

  constructor(ctx: HandlerContext, controller: ControllerBase) {
    this.ctx = ctx;
    if (!controller) {
      throw new Error(
        "ControllerBase is required: new HandlerX(ctx, this). No legacy ctx plumbing."
      );
    }
    this.controller = controller;

    const app = controller.getApp?.();
    if (!app) {
      throw new Error("ControllerBase.getApp() returned null/undefined.");
    }
    this.app = app;

    const registry = controller.getDtoRegistry?.();
    if (!registry) {
      throw new Error(
        "ControllerBase.getDtoRegistry() returned null/undefined."
      );
    }
    this.registry = registry;

    // Logger: prefer app logger, fall back to shared
    const appLog: IBoundLogger | undefined = (app as any)?.log;
    this.log =
      appLog?.bind?.({
        component: "HandlerBase",
        handler: this.constructor.name,
      }) ??
      getLogger({
        service: "shared",
        component: "HandlerBase",
        handler: this.constructor.name,
      });

    // Expose request-scoped logger back into context (optional convenience)
    this.ctx.set("log", this.log);

    // Construction is still DEBUG; pipeline-level traces focus on run()/execute()
    this.log.debug(
      {
        event: "construct",
        handlerStatus: this.ctx.get<string>("handlerStatus") ?? "ok",
        strict: true,
      },
      "HandlerBase ctor"
    );
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   * Must be static (no ctx/env reads).
   */
  protected abstract handlerPurpose(): string;

  /**
   * Optional stable handler name (wire/log name).
   * - Defaults to constructor name.
   * - Override for your "toBag.* / code.* / db.* / s2s.*" conventions.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected handlerName(): string {
    return this.constructor.name;
  }

  /**
   * Public accessor so test-runner can capture the stable handler name
   * without reaching into protected APIs.
   */
  public getHandlerName(): string {
    return this.handlerName();
  }

  /**
   * Escape hatch for compensating handlers / WAL / cleanup:
   * - Default: false → handler is skipped after a prior failure.
   * - Override in derived handlers that MUST run even when status>=400 or
   *   handlerStatus="error" (e.g., S2sUserDeleteOnFailureHandler).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected canRunAfterError(): boolean {
    return false;
  }

  /**
   * Handler-level test hook for test-runner.
   *
   * Contract:
   * - Default implementation returns undefined (no test).
   * - Test-runner calls runTest() on every handler instance and skips when undefined.
   * - Derived handlers with tests override runTest() and import their sibling *.test.ts.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async runTest(): Promise<HandlerTestResult | undefined> {
    return undefined;
  }

  /**
   * Shared helper to aggregate multiple scenario tests into ONE HandlerTestResult.
   *
   * Why:
   * - Keeps per-handler runTest() tiny (import scenarios, call this helper).
   * - Keeps the runner dumb and stable.
   *
   * Contract:
   * - If scenariosFactory returns an empty list → returns undefined (skip).
   * - Never throws (worst-case becomes a failed result).
   *
   * New behavior:
   * - Happy path FIRST (expectedError=false scenarios before expectedError=true).
   * - FAIL-FAST: once any scenario fails, stop executing further scenarios.
   */
  protected async runTestFromScenarios(input: {
    testId: string;
    testName: string;
    scenariosFactory: () => HandlerTestBase[];
  }): Promise<HandlerTestResult | undefined> {
    const startedAt = Date.now();

    let scenarios: HandlerTestBase[] = [];
    try {
      scenarios = input.scenariosFactory() ?? [];
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      return {
        testId: input.testId,
        name: input.testName,
        expectedError: false,
        outcome: "failed",
        assertionCount: 0,
        failedAssertions: [`scenariosFactory threw: ${msg}`],
        errorMessage: msg,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
    }

    if (!Array.isArray(scenarios) || scenarios.length === 0) {
      return undefined;
    }

    // Happy path first: expectedError=false before expectedError=true.
    // expectedError() is protected, so we access it best-effort via runtime.
    scenarios = [...scenarios].sort((a, b) => {
      const aExp = this.safeScenarioExpectedError(a);
      const bExp = this.safeScenarioExpectedError(b);
      return Number(aExp) - Number(bExp); // false(0) first
    });

    const failedAssertions: string[] = [];
    let assertionCount = 0;

    for (const t of scenarios) {
      try {
        const r = await t.run();
        assertionCount += r.assertionCount;

        if (r.outcome !== "passed") {
          const msg =
            r.errorMessage ||
            (r.failedAssertions && r.failedAssertions[0]) ||
            "unknown failure";
          failedAssertions.push(`${r.testId}: ${msg}`);
          break; // FAIL-FAST
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown error");
        failedAssertions.push(`${input.testId}: scenario runner threw: ${msg}`);
        break; // FAIL-FAST
      }
    }

    const finishedAt = Date.now();

    return {
      testId: input.testId,
      name: input.testName,
      expectedError: false,
      outcome: failedAssertions.length === 0 ? "passed" : "failed",
      assertionCount,
      failedAssertions,
      errorMessage:
        failedAssertions.length > 0 ? failedAssertions[0] : undefined,
      durationMs: Math.max(0, finishedAt - startedAt),
    };
  }

  private safeScenarioExpectedError(t: HandlerTestBase): boolean {
    try {
      const anyT = t as any;
      if (typeof anyT.expectedError === "function") {
        return anyT.expectedError() === true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  /**
   * Framework entrypoint called by controllers.
   * - Short-circuits on prior failure unless canRunAfterError() is true.
   * - Wraps execute() in a generic try/catch that records a structured
   *   UNHANDLED_HANDLER_EXCEPTION on ctx["error"] if no handler-level error
   *   was already recorded.
   */
  public async run(): Promise<void> {
    const status = this.ctx.get<number>("status");
    const handlerStatus = this.ctx.get<string>("handlerStatus");

    const hasPriorFailure =
      (status !== undefined && status >= 400) || handlerStatus === "error";

    if (hasPriorFailure && !this.canRunAfterError()) {
      this.log.pipeline(
        {
          event: "short_circuit",
          reason: "prior_failure",
          handler: this.constructor.name,
          status,
          handlerStatus,
          canRunAfterError: false,
        },
        "Handler run() short-circuited due to prior failure"
      );
      return;
    }

    this.log.pipeline(
      {
        event: "execute_start",
        handler: this.constructor.name,
      },
      "Handler execute() start"
    );

    try {
      await this.execute();
    } catch (err) {
      // If a lower-level helper (e.g., getMongoConfig) already called
      // failWithError(), handlerStatus will be "error". In that case we do
      // NOT want to wrap it again and overwrite the more specific error.
      const afterStatus = this.ctx.get<string>("handlerStatus");
      if (afterStatus === "error") {
        this.log.pipeline(
          {
            event: "execute_exception_after_handler_error",
            handler: this.constructor.name,
          },
          "Handler threw after recording structured error; skipping secondary failWithError"
        );
        return;
      }

      this.failWithError({
        httpStatus: 500,
        title: "internal_handler_error",
        detail:
          "Handler threw an unhandled exception. " +
          "Ops: search logs for 'handler.unhandled_exception' and the requestId; " +
          "use origin.handler and origin.purpose to locate the failing handler.",
        stage: "HandlerBase.run",
        rawError: err,
        logMessage: "handler.unhandled_exception",
      });
    }

    this.log.pipeline(
      {
        event: "execute_end",
        handler: this.constructor.name,
        handlerStatus: this.ctx.get<string>("handlerStatus") ?? "ok",
        status: this.ctx.get<number>("status") ?? 200,
      },
      "Handler execute() end"
    );
  }

  /**
   * Strict accessor for per-service environment variables.
   *
   * Overloads:
   * - getVar(key)                    → string | undefined  (optional env var)
   * - getVar(key, false)             → string | undefined  (same as above)
   * - getVar(key, true)              → string              (required; throws if missing/empty)
   *
   * Semantics:
   * - Reads ONLY from ControllerBase.getSvcEnv().getVar(key) via helper.
   * - Never falls back to process.env or ctx.
   */
  protected getVar(key: string): string | undefined;
  protected getVar(key: string, required: false): string | undefined;
  protected getVar(key: string, required: true): string;
  protected getVar(key: string, required: boolean = false): string | undefined {
    return getEnvVarFromSvcEnv({
      controller: this.controller,
      log: this.log,
      handlerName: this.constructor.name,
      key,
      required,
    });
  }

  /**
   * Canonical Mongo config accessor for handlers.
   *
   * Usage pattern in handlers:
   *
   *   const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();
   *
   * Behavior:
   * - On success: returns { uri, dbName }.
   * - On failure:
   *   • Calls failWithError() with a detailed mongo_config_error.
   *   • Throws, so callers do NOT need to write 19 truthy checks.
   */
  protected getMongoConfig(): { uri: string; dbName: string } {
    try {
      return resolveMongoConfigWithDbState({
        controller: this.controller,
        log: this.log,
        handlerName: this.constructor.name,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");

      this.failWithError({
        httpStatus: 500,
        title: "mongo_config_error",
        detail:
          msg +
          " Ops: verify NV_MONGO_URI, NV_MONGO_DB, DB_STATE, and the env-service configuration document for this service/version. " +
          "Infra DBs must end with `_infra`; domain DBs require a valid DB_STATE.",
        stage: `${this.handlerPurpose()}:mongo.config`,
        rawError: err,
        origin: {
          method: "getMongoConfig",
        },
        logMessage:
          "mongo_config_error: failure resolving Mongo configuration; aborting handler.",
        logLevel: "error",
      });

      // Throw so handler.execute() stops immediately.
      throw err;
    }
  }

  protected safeCtxGet<T = unknown>(key: string): T | undefined {
    try {
      return this.ctx.get<T | undefined>(key);
    } catch (err) {
      this.log.debug(
        {
          event: "safeCtxGet_error",
          handler: this.constructor.name,
          key,
          error: err instanceof Error ? err.message : String(err),
        },
        "safeCtxGet: ctx.get() threw; returning undefined"
      );
      return undefined;
    }
  }

  protected getRequestId(): string {
    const raw = this.safeCtxGet<any>("requestId");
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed !== "") {
        return trimmed;
      }
    }
    return "unknown";
  }

  protected safeServiceSlug(): string | undefined {
    try {
      const appAny = this.app as any;
      if (typeof appAny.getSlug === "function") {
        const slug = appAny.getSlug();
        if (typeof slug === "string" && slug.trim() !== "") return slug;
      }
    } catch (err) {
      this.log.debug(
        {
          event: "safeServiceSlug_error",
          handler: this.constructor.name,
          error: err instanceof Error ? err.message : String(err),
        },
        "safeServiceSlug: getSlug() threw; falling back to ctx['slug']"
      );
    }

    return this.safeCtxGet<string>("slug");
  }

  protected safeDtoType(): string | undefined {
    return this.safeCtxGet<string>("dtoType");
  }

  protected safePipeline(): string | undefined {
    return this.safeCtxGet<string>("pipeline");
  }

  protected failWithError(input: FailWithErrorInput): NvHandlerError {
    const requestId = input.requestId ?? this.safeCtxGet<string>("requestId");

    return logAndAttachHandlerError({
      ctx: this.ctx,
      log: this.log,
      handlerName: this.constructor.name,
      handlerPurpose: this.handlerPurpose(),
      requestId,
      input,
      safe: {
        pipeline: () => this.safePipeline(),
        dtoType: () => this.safeDtoType(),
        slug: () => this.safeServiceSlug(),
      },
    });
  }

  protected abstract execute(): Promise<void>;
}
