// backend/services/shared/src/http/handlers/testing/HandlerTestBase.ts
/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0102 (Registry sole DTO creation authority)
 * - ADR-0103 (DTO key naming)
 *
 * Purpose:
 * - Shared base class for handler-level tests.
 *
 * Invariants:
 * - Tests MUST construct DTOs via registry.create(dtoKey, body?) only.
 * - No legacy registry surfaces (no resolveCtorByType/dbCollectionNameByType/createDto).
 */

import type { ILogger, IBoundLogger } from "../../../logger/Logger";
import { DtoBag } from "../../../dto/DtoBag";
import type { DtoBase } from "../../../dto/DtoBase";
import { HandlerContext } from "../HandlerContext";
import type { HandlerBase } from "../HandlerBase";
import type { ControllerBase } from "../../../base/controller/ControllerBase";
import type { AppBase } from "../../../base/app/AppBase";
import type { IDtoRegistry } from "../../../registry/IDtoRegistry";
import { withRequestScope } from "../../requestScope";

export type HandlerTestOutcome = "passed" | "failed";
export type HandlerTestRailsVerdict = "ok" | "rails_error" | "test_bug";

export interface HandlerTestResult {
  testId: string;
  name: string;
  outcome: HandlerTestOutcome;
  expectedError: boolean;
  assertionCount: number;
  failedAssertions: string[];
  errorMessage?: string;
  durationMs: number;

  railsVerdict?: HandlerTestRailsVerdict;
  railsStatus?: number;
  railsHandlerStatus?: string;
  railsResponseStatus?: number;
}

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
  bag?: unknown;
  pipeline?: string;
  slug?: string;
  headers?: Record<string, string>;
};

export type HandlerTestHarnessOptions = {
  app?: AppBase;
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

  protected expectedError(): boolean {
    return false;
  }

  private _suffix?: string;
  protected suffix(): string {
    if (this._suffix) return this._suffix;
    const ts = Date.now().toString(36);
    this._suffix = ts.slice(-6);
    return this._suffix;
  }

  public async run(): Promise<HandlerTestResult> {
    const startedAt = Date.now();

    const failedAssertions: string[] = [];
    let errorMessage: string | undefined;
    let outcome: HandlerTestOutcome = "passed";

    const expectedError = this.expectedError() === true;
    const scopeRequestId = `ht-${this.testId()}`.slice(0, 120);

    this.lastRails = { verdict: "ok" };

    try {
      await withRequestScope(
        {
          requestId: scopeRequestId,
          testRunId: this.testId(),
          expectErrors: expectedError,
        },
        async () => {
          await this.execute();
        }
      );
    } catch (err) {
      outcome = "failed";
      errorMessage = this.toErrorMessage(err);
      failedAssertions.push(errorMessage);

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

      this.log?.error?.(
        {
          testId: this.testId(),
          name: this.testName(),
          error: errorMessage,
          expectedError,
        },
        "handler-test: failure"
      );
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
    ctx.set("dtoKey", dtoType);
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

    if (seed && "headers" in seed) {
      ctx.set("headers", { ...(seed.headers ?? {}) });
    }
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
              `HANDLER_TEST_SVCENV_VAR_ACCESS: attempted to read env var "${key}" without a real SvcEnv.`
            );
          },
        } as any),
    } as unknown as ControllerBase;

    return controllerStub;
  }

  protected async runHandler<T extends HandlerBase>(input: {
    handlerCtor: HandlerCtor<T>;
    ctx: HandlerContext;
    harness?: HandlerTestHarnessOptions;
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

    this.lastRails = {
      verdict: railsError ? "rails_error" : "ok",
      handlerStatus,
      status,
      responseStatus,
    };

    if (!expectedError && railsError) {
      throw new Error(
        `RAILS_VERDICT: unexpected rails error. handlerStatus=${handlerStatus}, status=${status}, responseStatus=${String(
          responseStatus ?? "(n/a)"
        )}`
      );
    }

    if (expectedError && !railsError) {
      this.lastRails = { verdict: "ok", handlerStatus, status, responseStatus };
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

  protected makeDtoJsonFromRegistry<TDto extends DtoBase>(
    dtoKey: string,
    seed: (dto: TDto) => void
  ): Record<string, unknown> {
    const registry = this.defaultHarness?.registry;
    if (!registry) {
      throw new Error(
        "HANDLER_TEST_DTO_REGISTRY_MISSING: makeDtoJsonFromRegistry() requires harness.registry."
      );
    }

    const dto = registry.create<TDto>(dtoKey);
    seed(dto);

    const body = (dto as any).toBody?.();
    if (!body || typeof body !== "object") {
      throw new Error(
        `HANDLER_TEST_DTO_TO_BODY_INVALID: DTO "${dtoKey}" toBody() did not return an object.`
      );
    }

    return body as Record<string, unknown>;
  }

  public assert(condition: unknown, message: string): void {
    this.recordAssertion();
    if (!condition) throw new Error(message);
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

  public assertCtxUUID(ctx: HandlerContext, key: string): string {
    const value = this.assertCtxNonEmptyString(ctx, key);
    this.assert(
      HandlerTestBase.uuidV4Regex.test(value),
      `CTX[${this.testName()}]: key "${key}" expected UUIDv4, got "${value}".`
    );
    return value;
  }

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
      `CTX[${this.testName()}]: key "${key}" expected string.`
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

  public assertBagCount<TDto extends DtoBase>(
    bag: DtoBag<TDto>,
    comparator: "eq0" | "eq1" | "ge0" | "ge1",
    label?: string
  ): void {
    const ctxLabel = label || this.testId();
    let count = 0;
    for (const _ of bag.items()) count += 1;

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
          "HANDLER_TEST_SVCCLIENT_MISSING: handler attempted to call getSvcClient() but harness.app was not supplied."
        );
      },
      ...(log ? { log } : {}),
    };

    return stub as AppBase;
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
