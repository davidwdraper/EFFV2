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
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Abstract base for handlers:
 *   • DI of HandlerContext + ControllerBase (required)
 *   • Access to App, Registry, Logger via controller getters
 *   • Short-circuit on prior failure
 *   • Standardized instrumentation via bound logger
 *   • Thin wrappers over runtime env + error helpers
 *   • Optional per-handler runTest() hook for test-runner
 *
 * Invariants (locked here; downstream stops defending):
 * - Controllers MUST pass `this` into handler constructors.
 * - SvcRuntime is REQUIRED (no rt = no handler).
 * - No reading plumbing from ctx (no ctx.get('app'), etc).
 * - Handlers never access process.env or transport objects.
 * - Default HandlerBase.runTest() NEVER returns undefined; it yields a
 *   concrete TestError HandlerTestResult w/ reason="NO_TEST_PROVIDED".
 *
 * Mongo config override (env-service boot edge-case):
 * - Handlers may use a pipeline-seeded override:
 *     • ctx["db.mongo.uri"]
 *     • ctx["db.mongo.dbName"]
 * - If both are present and non-empty, they win over SvcRuntime vars.
 * - This is required for env-service /config reads before runtime vars exist.
 */

import { HandlerContext } from "./HandlerContext";
import { getLogger, type IBoundLogger } from "../../logger/Logger";
import type { AppBase } from "../../base/app/AppBase";
import type { IDtoRegistry } from "../../registry/RegistryBase";
import type { ControllerBase } from "../../base/controller/ControllerBase";
import type { SvcRuntime } from "../../runtime/SvcRuntime";
import {
  getEnvVarFromRuntime,
  resolveMongoConfigWithDbState,
} from "./handlerBaseExt/envHelpers";
import {
  logAndAttachHandlerError,
  type NvHandlerError,
  type FailWithErrorInput,
} from "./handlerBaseExt/errorHelpers";

import type { HandlerTestBase } from "./testing/HandlerTestBase";
import type { HandlerTestResult } from "./testing/HandlerTestBase";

export type { NvHandlerError } from "./handlerBaseExt/errorHelpers";

export abstract class HandlerBase {
  protected readonly ctx: HandlerContext;
  protected readonly log: IBoundLogger;

  protected readonly controller: ControllerBase;
  protected readonly app: AppBase;
  protected readonly registry: IDtoRegistry;

  /**
   * `rt` is intentionally short: it should be the only runtime “global”
   * a handler can see. If it isn’t present, the service is mis-wired.
   *
   * Invariant:
   * - Runtime identity is authoritative (ADR-0080). No ctx fallback.
   */
  protected readonly rt: SvcRuntime;

  constructor(ctx: HandlerContext, controller: ControllerBase) {
    this.ctx = ctx;

    if (!controller) {
      throw new Error(
        "ControllerBase is required: new HandlerX(ctx, this). No legacy ctx plumbing."
      );
    }
    this.controller = controller;

    // HARD REQUIRE: SvcRuntime must exist or the service is mis-wired.
    // “No seatbelt, no ignition.”
    const rt = this.controller.getRuntime();
    if (!rt) {
      throw new Error(
        "SvcRuntime is required: ControllerBase.getRuntime() returned null/undefined. " +
          "Ops: ensure the service is SvcRuntime'd before wiring handlers."
      );
    }
    this.rt = rt;

    const app = controller.getApp();
    if (!app) {
      throw new Error("ControllerBase.getApp() returned null/undefined.");
    }
    this.app = app;

    const registry = controller.getDtoRegistry();
    if (!registry) {
      throw new Error(
        "ControllerBase.getDtoRegistry() returned null/undefined."
      );
    }
    this.registry = registry;

    const appLog = (app as unknown as { log?: IBoundLogger }).log;
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

    this.ctx.set("log", this.log);

    this.log.debug(
      {
        event: "construct",
        handlerStatus: this.ctx.get<string>("handlerStatus") ?? "ok",
        hasRuntime: true,
      },
      "HandlerBase ctor"
    );
  }

  protected abstract handlerPurpose(): string;

  protected handlerName(): string {
    return this.constructor.name;
  }

  public getHandlerName(): string {
    return this.handlerName();
  }

  protected canRunAfterError(): boolean {
    return false;
  }

  public async runTest(): Promise<HandlerTestResult | undefined> {
    const handlerName =
      typeof (this as any).getHandlerName === "function"
        ? (this as any).getHandlerName()
        : this.constructor.name;

    const startedAt = Date.now();

    const msg =
      "HandlerBase.runTest() default invoked. hasTest() is likely true but runTest() not overridden. " +
      "Provide a HandlerTestBase test and override runTest() accordingly.";

    return {
      testId: `${handlerName}.NO_TEST_PROVIDED`,
      name: `${handlerName}: no test implementation`,
      expectedError: false,
      outcome: "failed",
      assertionCount: 0,
      failedAssertions: [`NO_TEST_PROVIDED: ${msg}`],
      errorMessage: msg,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  protected buildStandardTestInit(): any {
    return {
      log: this.log,
      harness: {
        app: this.app,
        registry: this.registry,
      },
    };
  }

  protected async runSingleTest(
    TestCtor: new (init?: any) => HandlerTestBase
  ): Promise<HandlerTestResult | undefined> {
    const init = this.buildStandardTestInit();
    const test = new TestCtor(init);
    return test.run();
  }

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

    scenarios = [...scenarios].sort((a, b) => {
      const aExp = this.safeScenarioExpectedError(a);
      const bExp = this.safeScenarioExpectedError(b);
      return Number(aExp) - Number(bExp);
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
          break;
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err ?? "unknown");
        failedAssertions.push(`${input.testId}: scenario threw: ${msg}`);
        break;
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
      errorMessage: failedAssertions[0],
      durationMs: Math.max(0, finishedAt - startedAt),
    };
  }

  private safeScenarioExpectedError(t: HandlerTestBase): boolean {
    try {
      const anyT = t as any;
      if (typeof anyT.expectedError === "function") {
        return anyT.expectedError() === true;
      }
    } catch {}
    return false;
  }

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
        "Handler run() short-circuited"
      );
      return;
    }

    this.log.pipeline(
      { event: "execute_start", handler: this.constructor.name },
      "Handler execute() start"
    );

    try {
      await this.execute();
    } catch (err) {
      const afterStatus = this.ctx.get<string>("handlerStatus");
      if (afterStatus === "error") {
        this.log.pipeline(
          {
            event: "execute_exception_after_handler_error",
            handler: this.constructor.name,
          },
          "Handler threw after structured error; skip secondary failWithError"
        );
        return;
      }

      this.failWithError({
        httpStatus: 500,
        title: "internal_handler_error",
        detail:
          "Handler threw unhandled exception. Ops: inspect logs + stack via requestId.",
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

  protected getVar(key: string): string | undefined;
  protected getVar(key: string, required: false): string | undefined;
  protected getVar(key: string, required: true): string;
  protected getVar(key: string, required: boolean = false): string | undefined {
    return getEnvVarFromRuntime({
      controller: this.controller,
      log: this.log,
      handlerName: this.constructor.name,
      key,
      required,
    });
  }

  /**
   * Mongo config resolution:
   * 1) Optional pipeline override via ctx["db.mongo.*"] (wins if complete)
   * 2) Fallback to SvcRuntime vars (DB_STATE-aware) via resolveMongoConfigWithDbState()
   */
  protected getMongoConfig(): { uri: string; dbName: string } {
    // 1) Pipeline override (env-service boot edge-case)
    const oUri = this.safeCtxGet<string>("db.mongo.uri");
    const oDb = this.safeCtxGet<string>("db.mongo.dbName");

    const uriTrim = typeof oUri === "string" ? oUri.trim() : "";
    const dbTrim = typeof oDb === "string" ? oDb.trim() : "";

    if (uriTrim && dbTrim) {
      this.log.debug(
        {
          event: "mongo_config_override_used",
          handler: this.constructor.name,
          dbName: dbTrim,
        },
        "getMongoConfig: using ctx['db.mongo.*'] override"
      );
      return { uri: uriTrim, dbName: dbTrim };
    }

    if (uriTrim || dbTrim) {
      this.failWithError({
        httpStatus: 500,
        title: "mongo_config_override_incomplete",
        detail:
          "Mongo override in ctx is incomplete. Dev: if you seed db.mongo overrides, you must set BOTH ctx['db.mongo.uri'] and ctx['db.mongo.dbName'].",
        stage: `${this.handlerPurpose()}:mongo.override`,
        origin: { method: "getMongoConfig" },
        issues: [{ uriPresent: !!uriTrim, dbPresent: !!dbTrim }],
        logMessage:
          "mongo_config_override_incomplete: only one db.mongo.* override key was present.",
        logLevel: "error",
      });
      throw new Error("mongo_config_override_incomplete");
    }

    // 2) Standard path: runtime vars (DB_STATE-aware)
    try {
      return resolveMongoConfigWithDbState({
        controller: this.controller,
        log: this.log,
        handlerName: this.constructor.name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "unknown");
      this.failWithError({
        httpStatus: 500,
        title: "mongo_config_error",
        detail:
          msg +
          " Ops: verify NV_MONGO_URI, NV_MONGO_DB, DB_STATE, and runtime wiring. `_infra` DBs are state-invariant; domain DBs require DB_STATE decoration.",
        stage: `${this.handlerPurpose()}:mongo.config`,
        rawError: err,
        origin: { method: "getMongoConfig" },
        logMessage:
          "mongo_config_error resolving Mongo configuration; aborting handler.",
        logLevel: "error",
      });
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
      if (trimmed !== "") return trimmed;
    }
    return "unknown";
  }

  protected safeServiceSlug(): string | undefined {
    try {
      const slug = this.rt.getServiceSlug();
      return typeof slug === "string" && slug.trim() ? slug.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  protected safeDtoType(): string | undefined {
    return this.safeCtxGet<string>("dtoType");
  }

  protected safePipeline(): string | undefined {
    return this.safeCtxGet<string>("pipeline");
  }

  protected failWithError(input: FailWithErrorInput): NvHandlerError {
    const requestId = input.requestId ?? this.getRequestId();

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
