// backend/services/shared/src/http/handlers/testing/HandlerTestBase.ts
/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Shared base class for handler-level tests.
 * - Handles:
 *   • standard run() wrapper with pass/fail result,
 *   • assertion helpers with consistent counting,
 *   • BagCount checks for DtoBag instances,
 *   • STANDARDIZED HandlerContext bus seeding (defaults + deltas),
 *   • STANDARDIZED handler execution wrapper that mirrors production:
 *       new Handler(ctx, controller).run()
 *
 * Invariants:
 * - Tests throw on assertion failure; HandlerTestBase converts that into a
 *   structured HandlerTestResult.
 * - Tests live side-by-side with the handler under test:
 *   code.foo.bar.ts + code.foo.bar.test.ts.
 * - Tests seed ONLY handler-specific deltas; defaults come from seedDefaults().
 *
 * Notes:
 * - Must live under `http/handlers/testing` to match imports.
 * - Files within shared MUST use explicit relative imports (no @nv/shared/*).
 */

import type { ILogger, IBoundLogger } from "../../../logger/Logger";
import { DtoBag } from "../../../dto/DtoBag";
import type { DtoBase } from "../../../dto/DtoBase";
import { HandlerContext } from "../HandlerContext";
import type { HandlerBase } from "../HandlerBase";
import type { ControllerBase } from "../../../base/controller/ControllerBase";
import type { AppBase } from "../../../base/app/AppBase";
import type { IDtoRegistry } from "../../../registry/RegistryBase";

export type HandlerTestOutcome = "passed" | "failed";

export interface HandlerTestResult {
  testId: string;
  name: string;
  outcome: HandlerTestOutcome;
  assertionCount: number;
  failedAssertions: string[];
  errorMessage?: string;
  durationMs: number;
}

/**
 * Canonical minimal wire-bag envelope used by many handlers at edges.
 * Tests can override with a full payload when needed.
 */
export function defaultWireBagEnvelope(): {
  items: unknown[];
  meta?: Record<string, unknown>;
} {
  return { items: [] };
}

export type HandlerTestSeed = {
  requestId?: string;
  dtoType?: string;
  op?: string;
  body?: unknown;

  /**
   * Default: do NOT seed ctx["bag"] unless explicitly provided.
   * This prevents false positives where a handler “finds” a bag that no one seeded.
   */
  bag?: unknown;

  /**
   * Optional convenience keys commonly used in handlers/pipelines.
   * Only seeded if provided.
   */
  pipeline?: string;
  slug?: string;
};

/**
 * High-level harness inputs:
 * - app + registry can be provided by the caller (preferred when running inside a real service).
 * - If omitted, we create minimal stubs that satisfy HandlerBase constructor invariants.
 *
 * IMPORTANT:
 * - For real S2S execution, you MUST supply an app that has getEnvLabel() + getSvcClient().
 *   The cleanest source is the *actual* AppBase instance from the running process
 *   that is constructing the handler tests (e.g., test-runner’s AppBase).
 */
export type HandlerTestHarnessOptions = {
  app?: AppBase;
  registry?: IDtoRegistry;

  /**
   * Optional explicit env label override (if your app stub uses it).
   * If omitted, harness will try app.getEnvLabel() and fall back to "dev".
   */
  envLabel?: string;

  /**
   * Optional logger for test diagnostics.
   * If provided, failures will be logged once per test.
   */
  log?: ILogger;
};

export type HandlerCtor<T extends HandlerBase> = new (
  ctx: HandlerContext,
  controller: ControllerBase
) => T;

export type HandlerRunResult = {
  handlerStatus: string;
  status: number;
  responseStatus?: number;
  responseBody?: unknown;
  snapshot: Record<string, unknown>;
};

/**
 * Base class for all handler tests.
 * - Subclasses implement testId(), testName(), and execute().
 * - run() is the single entrypoint used by the test-runner.
 */
export abstract class HandlerTestBase {
  protected readonly log?: ILogger;

  private assertionCount = 0;

  constructor(params?: { log?: ILogger }) {
    this.log = params?.log;
  }

  /** Stable test identifier (used in logs and summaries). */
  public abstract testId(): string;

  /** Human-friendly name for ops and developers. */
  public abstract testName(): string;

  /**
   * Main entrypoint called by the test-runner.
   * - Wraps execute() in a try/catch and returns a structured result.
   */
  public async run(): Promise<HandlerTestResult> {
    const startedAt = Date.now();

    const failedAssertions: string[] = [];
    let errorMessage: string | undefined;
    let outcome: HandlerTestOutcome = "passed";

    try {
      await this.execute();
    } catch (err) {
      outcome = "failed";
      errorMessage = this.toErrorMessage(err);
      failedAssertions.push(errorMessage);

      if (this.log) {
        this.log.error(
          {
            testId: this.testId(),
            name: this.testName(),
            error: errorMessage,
          },
          "handler-test: failure"
        );
      }
    }

    const finishedAt = Date.now();

    return {
      testId: this.testId(),
      name: this.testName(),
      outcome,
      assertionCount: this.assertionCount,
      failedAssertions,
      errorMessage,
      durationMs: Math.max(0, finishedAt - startedAt),
    };
  }

  /**
   * Subclasses implement the actual test logic here.
   * - Throw on failure; do not swallow errors.
   */
  protected abstract execute(): Promise<void>;

  // ------------------------------
  // KISS Harness: seed → run → compare
  // ------------------------------

  /**
   * Create a fresh HandlerContext with deterministic defaults.
   * Tests should call this once, then seed only handler-specific deltas.
   */
  protected makeCtx(seed?: HandlerTestSeed): HandlerContext {
    const ctx = new HandlerContext();
    this.seedDefaults(ctx, seed);
    return ctx;
  }

  /**
   * Seed deterministic defaults onto an existing ctx.
   * Safe to call exactly once per ctx.
   */
  protected seedDefaults(ctx: HandlerContext, seed?: HandlerTestSeed): void {
    const requestId = (seed?.requestId ?? "req-test").trim() || "req-test";
    const dtoType = (seed?.dtoType ?? "test").trim() || "test";
    const op = (seed?.op ?? "test").trim() || "test";
    const body = seed?.body ?? defaultWireBagEnvelope();

    ctx.set("requestId", requestId);
    ctx.set("dtoType", dtoType);
    ctx.set("op", op);
    ctx.set("body", body);

    // Optional conventional keys
    if (typeof seed?.pipeline === "string" && seed.pipeline.trim() !== "") {
      ctx.set("pipeline", seed.pipeline.trim());
    }
    if (typeof seed?.slug === "string" && seed.slug.trim() !== "") {
      ctx.set("slug", seed.slug.trim());
    }

    // DO NOT seed ctx["bag"] unless explicitly asked.
    if (typeof seed?.bag !== "undefined") {
      ctx.set("bag", seed.bag);
    }
  }

  /**
   * Convenience for negative tests: remove a key.
   * Uses ctx.delete() (real API), not fake “set undefined” hacks.
   */
  protected remove(ctx: HandlerContext, key: string): void {
    ctx.delete(key);
  }

  /**
   * Build a ControllerBase harness that satisfies HandlerBase invariants:
   * - controller.getApp() must return an AppBase-like instance
   * - controller.getDtoRegistry() must return a registry (can be empty for tests)
   *
   * For REAL S2S execution, pass a real AppBase from the running process.
   */
  protected makeControllerHarness(
    opts: HandlerTestHarnessOptions = {}
  ): ControllerBase {
    const app = opts.app ?? this.makeAppStub(opts);
    const registry = opts.registry ?? ({} as IDtoRegistry);

    const controllerStub: ControllerBase = {
      getApp: () => app,
      getDtoRegistry: () => registry,

      // HandlerBase.getVar() uses controller.getSvcEnv() via envHelpers;
      // many handler tests won't touch getVar(), but if they do, we want a sane stub.
      getSvcEnv: () =>
        (app as any)?.getSvcEnv?.() ??
        ({
          env: (opts.envLabel ??
            (app as any)?.getEnvLabel?.() ??
            "dev") as string,
          getVar: (key: string) => {
            // No silent fallbacks. Tests must explicitly provide a real svc env if they need vars.
            throw new Error(
              `HANDLER_TEST_SVCENV_VAR_ACCESS: attempted to read env var "${key}" in a handler test without a real SvcEnv. ` +
                `Ops/Dev: provide a real AppBase (preferred) or extend the test harness to supply getSvcEnv().getVar("${key}").`
            );
          },
        } as any),
    } as unknown as ControllerBase;

    return controllerStub;
  }

  /**
   * Run a handler exactly like production:
   *   const h = new Handler(ctx, controller); await h.run();
   *
   * Returns a small, comparable result surface.
   */
  protected async runHandler<T extends HandlerBase>(input: {
    handlerCtor: HandlerCtor<T>;
    ctx: HandlerContext;
    harness?: HandlerTestHarnessOptions;
  }): Promise<HandlerRunResult> {
    const controller = this.makeControllerHarness(input.harness);

    const handler = new input.handlerCtor(input.ctx, controller);
    await handler.run();

    const handlerStatus = input.ctx.get<string>("handlerStatus") ?? "ok";
    const status = input.ctx.get<number>("status") ?? 200;

    const responseStatus = input.ctx.get<number>("response.status");
    const responseBody = input.ctx.get<unknown>("response.body");

    return {
      handlerStatus,
      status,
      responseStatus,
      responseBody,
      snapshot: input.ctx.snapshot(),
    };
  }

  /**
   * Minimal AppBase stub.
   *
   * WARNING:
   * - This does NOT provide real S2S.
   * - If you want S2S to actually execute (integration), pass the real AppBase via harness.app.
   */
  private makeAppStub(opts: HandlerTestHarnessOptions): AppBase {
    const envLabel =
      (opts.envLabel ?? "").trim() ||
      ((opts.app as any)?.getEnvLabel?.() as string) ||
      "dev";

    const log: IBoundLogger | undefined = (opts.app as any)?.log;

    const stub: Partial<AppBase> = {
      // Common patterns used by handlers
      getEnvLabel: () => envLabel,
      getSvcClient: () => {
        throw new Error(
          "HANDLER_TEST_SVCCLIENT_MISSING: handler attempted to call getSvcClient() but the test harness did not supply a real AppBase. " +
            "Dev: pass harness.app = real AppBase from the running service to execute real S2S."
        );
      },

      // Allow HandlerBase to prefer app.log if present
      ...(log ? { log } : {}),
    };

    return stub as AppBase;
  }

  // ------------------------------
  // Assertion Helpers (PUBLIC on purpose)
  // ------------------------------

  public assert(condition: unknown, message: string): void {
    this.recordAssertion();
    if (!condition) {
      throw new Error(message);
    }
  }

  public fail(message: string): never {
    this.recordAssertion();
    throw new Error(message);
  }

  public assertDefined<T>(
    value: T | null | undefined,
    message: string
  ): asserts value is T {
    this.assert(value !== null && value !== undefined, message);
  }

  public assertEq<T>(actual: T, expected: T, label?: string): void {
    const prefix = label ? `${label}: ` : "";
    this.assert(
      actual === expected,
      `${prefix}expected ${String(expected)}, got ${String(actual)}`
    );
  }

  public assertTrue(value: unknown, message: string): void {
    this.assert(value === true, message);
  }

  public assertFalse(value: unknown, message: string): void {
    this.assert(value === false, message);
  }

  // ------------------------------
  // BagCount helpers
  // ------------------------------

  public assertBagCount<TDto extends DtoBase>(
    bag: DtoBag<TDto>,
    comparator: "eq0" | "eq1" | "ge0" | "ge1",
    label?: string
  ): void {
    const ctxLabel = label || this.testId();
    let count = 0;

    for (const _ of bag.items()) {
      count += 1;
    }

    let ok = false;
    switch (comparator) {
      case "eq0":
        ok = count === 0;
        break;
      case "eq1":
        ok = count === 1;
        break;
      case "ge0":
        ok = count >= 0;
        break;
      case "ge1":
        ok = count >= 1;
        break;
      default:
        this.fail(
          `BagCount(${ctxLabel}): unsupported comparator "${comparator}".`
        );
    }

    this.assert(
      ok,
      `BagCount(${ctxLabel}): expected ${comparator}, actual=${count}.`
    );
  }

  // ------------------------------
  // Internal helpers
  // ------------------------------

  private recordAssertion(): void {
    this.assertionCount += 1;
  }

  private toErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return String(err ?? "unknown error");
  }
}
