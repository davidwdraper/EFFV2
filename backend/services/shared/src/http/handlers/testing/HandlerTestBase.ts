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
 * - Tests MUST use this.assert* helpers so assertionCount is meaningful.
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
import { withRequestScope } from "../../requestScope";

export type HandlerTestOutcome = "passed" | "failed";

/**
 * Rails verdict (separate from outcome):
 * - ok         => handler finished without error rails signals
 * - rails_error=> handler reported error rails signals (handlerStatus/status/response)
 * - test_bug   => test harness/test code threw before we could evaluate rails
 */
export type HandlerTestRailsVerdict = "ok" | "rails_error" | "test_bug";

export interface HandlerTestResult {
  testId: string;
  name: string;
  outcome: HandlerTestOutcome;

  /**
   * If true, this test is an "expected error" scenario and MUST run under
   * requestScope.expectErrors=true so downstream logs downgrade severity.
   */
  expectedError: boolean;

  assertionCount: number;
  failedAssertions: string[];
  errorMessage?: string;
  durationMs: number;

  /**
   * Rails verdict so “500 in the rails” cannot be reported as PASS.
   * - Runner must not reinterpret this; it is ops-facing truth.
   */
  railsVerdict?: HandlerTestRailsVerdict;
  railsStatus?: number;
  railsHandlerStatus?: string;
  railsResponseStatus?: number;
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

  /**
   * Optional HTTP headers bag for handlers that read from headers.
   * - Tests MUST use this property when seeding headers via makeCtx().
   * - Do NOT pass random extra properties to makeCtx(); extend HandlerTestSeed instead.
   */
  headers?: Record<string, string>;
};

export type HandlerTestHarnessOptions = {
  /**
   * IMPORTANT:
   * - For integration-style handler tests, the runner MUST supply a real AppBase
   *   so handler → controller.getApp().getSvcClient() is real.
   * - Tests MUST NOT branch on DB_MOCKS/S2S_MOCKS; SvcClient rails own that.
   */
  app?: AppBase;

  /**
   * Real DTO registry, same instance the service uses.
   * Tests MUST construct DTOs via the registry (never `new SomeDto()`).
   */
  registry?: IDtoRegistry;

  envLabel?: string;

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

type RailsSnapshot = {
  verdict: HandlerTestRailsVerdict;
  handlerStatus?: string;
  status?: number;
  responseStatus?: number;
};

/**
 * Base class for all handler tests.
 * - Subclasses implement testId(), testName(), and execute().
 * - run() is the single entrypoint used by the test-runner.
 */
export abstract class HandlerTestBase {
  private static readonly uuidV4Regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  protected readonly log?: ILogger;
  private readonly defaultHarness?: HandlerTestHarnessOptions;

  private assertionCount = 0;

  private lastRails: RailsSnapshot = { verdict: "ok" };

  constructor(params?: { log?: ILogger; harness?: HandlerTestHarnessOptions }) {
    this.log = params?.log;
    this.defaultHarness = params?.harness;
  }

  public abstract testId(): string;
  public abstract testName(): string;

  /**
   * Explicit marker for negative tests.
   * If you write a test that expects a handler error path, you MUST override this to true.
   */
  protected expectedError(): boolean {
    return false;
  }

  public async run(): Promise<HandlerTestResult> {
    const startedAt = Date.now();

    const failedAssertions: string[] = [];
    let errorMessage: string | undefined;
    let outcome: HandlerTestOutcome = "passed";

    const expectedError = this.expectedError() === true;

    const scopeRequestId = `ht-${this.testId()}`.slice(0, 120);

    // Reset rails snapshot each run.
    this.lastRails = { verdict: "ok" };

    try {
      await withRequestScope(
        {
          requestId: scopeRequestId,
          testRunId: this.testId(),
          expectErrors: expectedError,
        },
        async () => {
          // execute() is expected to call runHandler(); runHandler enforces rails verdict.
          await this.execute();
        }
      );
    } catch (err) {
      outcome = "failed";
      errorMessage = this.toErrorMessage(err);
      failedAssertions.push(errorMessage);

      // If runHandler already captured rails, trust it; otherwise classify.
      if (this.lastRails.verdict === "ok") {
        if (
          typeof errorMessage === "string" &&
          errorMessage.startsWith("RAILS_VERDICT:")
        ) {
          this.lastRails.verdict = "rails_error";
        } else {
          this.lastRails.verdict = "test_bug";
        }
      }

      if (this.log) {
        this.log.error(
          {
            testId: this.testId(),
            name: this.testName(),
            error: errorMessage,
            expectedError,
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
      expectedError,
      assertionCount: this.assertionCount,
      failedAssertions,
      errorMessage,
      durationMs: Math.max(0, finishedAt - startedAt),

      railsVerdict: this.lastRails.verdict,
      railsStatus: this.lastRails.status,
      railsHandlerStatus: this.lastRails.handlerStatus,
      railsResponseStatus: this.lastRails.responseStatus,
    };
  }

  protected abstract execute(): Promise<void>;

  // ------------------------------
  // KISS Harness: seed → run → compare
  // ------------------------------

  protected makeCtx(seed?: HandlerTestSeed): HandlerContext {
    const ctx = new HandlerContext();
    this.seedDefaults(ctx, seed);
    return ctx;
  }

  protected seedDefaults(ctx: HandlerContext, seed?: HandlerTestSeed): void {
    const requestId = (seed?.requestId ?? "req-test").trim() || "req-test";
    const dtoType = (seed?.dtoType ?? "test").trim() || "test";
    const op = (seed?.op ?? "test").trim() || "test";
    const body = seed?.body ?? defaultWireBagEnvelope();

    ctx.set("requestId", requestId);
    ctx.set("dtoType", dtoType);
    ctx.set("op", op);
    ctx.set("body", body);

    if (typeof seed?.pipeline === "string" && seed.pipeline.trim() !== "") {
      ctx.set("pipeline", seed.pipeline.trim());
    }
    if (typeof seed?.slug === "string" && seed.slug.trim() !== "") {
      ctx.set("slug", seed.slug.trim());
    }

    if (typeof seed?.bag !== "undefined") {
      ctx.set("bag", seed.bag);
    }

    /**
     * Headers:
     * - If the test passes a headers property (even an empty object),
     *   we seed ctx["headers"] with a shallow copy.
     * - This lets tests explicitly control "no headers" vs "no opinion".
     */
    if (seed && "headers" in seed) {
      ctx.set("headers", { ...(seed.headers ?? {}) });
    }
  }

  protected remove(ctx: HandlerContext, key: string): void {
    ctx.delete(key);
  }

  protected makeControllerHarness(
    opts: HandlerTestHarnessOptions = {}
  ): ControllerBase {
    const app = opts.app ?? this.makeAppStub(opts);
    const registry = opts.registry ?? ({} as IDtoRegistry);

    const controllerStub: ControllerBase = {
      getApp: () => app,
      getDtoRegistry: () => registry,
      getSvcEnv: () =>
        (app as any)?.getSvcEnv?.() ??
        ({
          env: (opts.envLabel ??
            (app as any)?.getEnvLabel?.() ??
            "dev") as string,
          getVar: (key: string) => {
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
   * Run a real handler instance under the rails AND enforce a rails verdict.
   *
   * This is the key fix:
   * - If expectedError=false, any rails error signal becomes a FAILED test (throws).
   * - If expectedError=true, lack of rails error becomes a FAILED test (throws).
   *
   * Result:
   * - A “500 in the rails” can’t be reported as PASS unless the test explicitly
   *   opts into expectedError().
   *
   * IMPORTANT:
   * - Harness selection order:
   *   1) input.harness (explicit)
   *   2) this.defaultHarness (runner-supplied)
   *   3) empty harness (stub app that throws on getSvcClient)
   */
  protected async runHandler<T extends HandlerBase>(input: {
    handlerCtor: HandlerCtor<T>;
    ctx: HandlerContext;
    harness?: HandlerTestHarnessOptions;

    /**
     * Optional override for negative tests.
     * Default: uses this.expectedError().
     */
    expectedError?: boolean;
  }): Promise<HandlerRunResult> {
    const harness = input.harness ?? this.defaultHarness ?? {};
    const controller = this.makeControllerHarness(harness);

    const handler = new input.handlerCtor(input.ctx, controller);
    await handler.run();

    const handlerStatus = input.ctx.get<string>("handlerStatus") ?? "ok";
    const status = input.ctx.get<number>("status") ?? 200;

    const responseStatus = input.ctx.get<number>("response.status");
    const responseBody = input.ctx.get<unknown>("response.body");

    const railsError =
      handlerStatus === "error" ||
      status >= 500 ||
      (typeof responseStatus === "number" && responseStatus >= 500);

    const expectedError = input.expectedError ?? this.expectedError() === true;

    // Snapshot rails fields for runner visibility (even on throw).
    this.lastRails = {
      verdict: railsError ? "rails_error" : "ok",
      handlerStatus,
      status,
      responseStatus,
    };

    // Enforce rails verdict (hard guarantee).
    if (!expectedError && railsError) {
      throw new Error(
        `RAILS_VERDICT: unexpected rails error. handlerStatus=${handlerStatus}, status=${status}, responseStatus=${String(
          responseStatus ?? "(n/a)"
        )}`
      );
    }

    if (expectedError && !railsError) {
      // Handler succeeded when it should have errored.
      this.lastRails = {
        verdict: "ok",
        handlerStatus,
        status,
        responseStatus,
      };

      throw new Error(
        `RAILS_VERDICT: expected rails error but handler succeeded. handlerStatus=${handlerStatus}, status=${status}, responseStatus=${String(
          responseStatus ?? "(n/a)"
        )}`
      );
    }

    return {
      handlerStatus,
      status,
      responseStatus,
      responseBody,
      snapshot: input.ctx.snapshot(),
    };
  }

  private makeAppStub(opts: HandlerTestHarnessOptions): AppBase {
    const envLabel =
      (opts.envLabel ?? "").trim() ||
      ((opts.app as any)?.getEnvLabel?.() as string) ||
      "dev";

    const log: IBoundLogger | undefined = (opts.app as any)?.log;

    const stub: Partial<AppBase> = {
      getEnvLabel: () => envLabel,
      getSvcClient: () => {
        throw new Error(
          "HANDLER_TEST_SVCCLIENT_MISSING: handler attempted to call getSvcClient() but the test harness did not supply a real AppBase. " +
            "Dev: pass harness.app = real AppBase from the running service to execute real S2S."
        );
      },
      ...(log ? { log } : {}),
    };

    return stub as AppBase;
  }

  // ------------------------------
  // Assertion Helpers (MUST USE)
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
  // Context helpers (LDD-40)
  // ------------------------------

  public assertCtxHasValue(ctx: HandlerContext, key: string): unknown {
    const value = ctx.get<unknown>(key);
    this.assert(
      typeof value !== "undefined",
      `CTX[${this.testName()}]: missing key "${key}".`
    );
    return value;
  }

  public assertCtxString(ctx: HandlerContext, key: string): string {
    const value = this.assertCtxHasValue(ctx, key);
    this.assert(
      typeof value === "string",
      `CTX[${this.testName()}]: key "${key}" expected string, got ${typeof value}.`
    );
    return value as string;
  }

  public assertCtxNonEmptyString(ctx: HandlerContext, key: string): string {
    const value = this.assertCtxString(ctx, key);
    this.assert(
      value.trim().length > 0,
      `CTX[${this.testName()}]: key "${key}" expected non-empty string.`
    );
    return value;
  }

  public assertCtxStringEquals(
    ctx: HandlerContext,
    key: string,
    expected: string
  ): void {
    const value = this.assertCtxString(ctx, key);
    this.assert(
      value === expected,
      `CTX[${this.testName()}]: key "${key}" expected "${expected}", got "${value}".`
    );
  }

  public assertCtxStringMatches(
    ctx: HandlerContext,
    key: string,
    regex: RegExp
  ): string {
    const value = this.assertCtxString(ctx, key);
    this.assert(
      regex.test(value),
      `CTX[${this.testName()}]: key "${key}" value "${value}" did not match ${regex}.`
    );
    return value;
  }

  public assertCtxValueIsZero(ctx: HandlerContext, key: string): void {
    const value = this.assertCtxHasValue(ctx, key);
    this.assert(
      value === 0,
      `CTX[${this.testName()}]: key "${key}" expected 0, got ${String(value)}.`
    );
  }

  public assertCtxValueIsNotZero(ctx: HandlerContext, key: string): void {
    const value = this.assertCtxHasValue(ctx, key);
    this.assert(
      value !== 0,
      `CTX[${this.testName()}]: key "${key}" expected non-zero, got ${String(
        value
      )}.`
    );
  }

  public assertCtxUUID(ctx: HandlerContext, key: string): string {
    const value = this.assertCtxNonEmptyString(ctx, key);
    this.assert(
      HandlerTestBase.uuidV4Regex.test(value),
      `CTX[${this.testName()}]: key "${key}" expected UUIDv4, got "${value}".`
    );
    return value;
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
  // DTO + JSON helpers (via Registry ONLY)
  // ------------------------------

  /**
   * Creates a short-lived DTO via the real Registry, seeds it with a provided
   * function, then returns its canonical JSON representation (dto.toBody()).
   *
   * Invariants:
   * - NO direct DTO construction (no `new SomeDto()`); everything flows through Registry.
   * - If Registry is missing, this throws loudly so tests cannot silently cheat.
   */
  protected makeDtoJsonFromRegistry<TDto extends DtoBase>(
    dtoTypeKey: string,
    seed: (dto: TDto) => void
  ): Record<string, unknown> {
    const registry = this.defaultHarness?.registry;
    if (!registry) {
      throw new Error(
        "HANDLER_TEST_DTO_REGISTRY_MISSING: makeDtoJsonFromRegistry() " +
          "requires harness.registry so DTOs are constructed via the real Registry."
      );
    }

    // NOTE: this assumes the Registry exposes a create/new API that returns
    // a fully wired DTO instance (with the secret) for dtoTypeKey.
    // Adjust the member name to match your IDtoRegistry implementation.
    const dto = (registry as any).createDto(dtoTypeKey) as TDto;

    if (!dto || typeof (dto as any).toBody !== "function") {
      throw new Error(
        `HANDLER_TEST_DTO_REGISTRY_INVALID: Registry.createDto("${dtoTypeKey}") ` +
          "did not return a DTO with toBody()."
      );
    }

    seed(dto as TDto);

    const body = (dto as any).toBody();
    if (!body || typeof body !== "object") {
      throw new Error(
        `HANDLER_TEST_DTO_TO_BODY_INVALID: DTO "${dtoTypeKey}" toBody() did not return an object.`
      );
    }

    return body as Record<string, unknown>;
  }

  private recordAssertion(): void {
    this.assertionCount += 1;
  }

  private toErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return String(err ?? "unknown error");
  }
}
