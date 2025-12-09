// backend/services/shared/src/http/HandlerBase.ts
/**
 * Docs:
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Hydration + Failure Propagation)
 * - ADR-0049 (DTO Registry & Wire Discrimination)
 * - ADR-0058 (HandlerBase.getVar — Strict Env Accessor)
 *
 * Purpose:
 * - Abstract base for handlers:
 *   • DI of HandlerContext + ControllerBase (required)
 *   • Access to App, Registry, Logger via controller getters
 *   • Short-circuit on prior failure
 *   • Standardized instrumentation via bound logger
 *   • Provides getVar(key) — strict per-service env accessor
 *
 * Invariants:
 * - Controllers MUST pass `this` into handler constructors.
 * - No reading plumbing from ctx (no ctx.get('app'), etc).
 * - getVar() reads only from ControllerBase.getSvcEnv().getVar()
 *   (never from ctx or process.env)
 *
 * Standard try/catch usage template for handlers
 * ----------------------------------------------
 *
 * protected override async execute(): Promise<void> {
 *   const requestId = this.getRequestId();
 *
 *   try {
 *     // WORK SECTION — code that may throw
 *     // const bag = this.ctx.get(...);
 *     // const svcClient = this.app.getSvcClient();
 *     // const result = await svcClient.call({...});
 *   } catch (err) {
 *     this.failWithError({
 *       httpStatus: 500, // or 400/502/etc
 *       title: "some_human_readable_title",
 *       detail:
 *         "Explain what failed and what Ops should check. " +
 *         "Keep it specific to this handler.",
 *       stage: "short-label-describing-where-it-failed",
 *       rawError: err,
 *       // origin properties are optional; HandlerBase will best-effort fill:
 *       // You can still override fields explicitly if needed:
 *       origin: {
 *            file: __filename
 *            //   pipeline → ctx["pipeline"]
 *            //   dtoType  → ctx["dtoType"]
 *            //   slug     → app.getSlug() or ctx["slug"]
 *        }
 *     });
 *     return;
 *   }
 *
 *   this.ctx.set("handlerStatus", "success");
 * }
 */

import { HandlerContext } from "./HandlerContext";
import { getLogger, type IBoundLogger } from "../../logger/Logger";
import type { AppBase } from "../../base/app/AppBase";
import type { IDtoRegistry } from "../../registry/RegistryBase";
import type { ControllerBase } from "../../base/controller/ControllerBase";

/**
 * Structured handler error shape used on ctx["error"].
 * Codes are simple strings for now; origin carries rich context
 * for Ops triage (service, handler, purpose, stage, dtoType, etc).
 */
export type NvHandlerError = {
  httpStatus: number;
  title: string;
  detail: string;
  requestId?: string;
  promptKey?: string;
  issues?: unknown[];
  origin?: {
    service?: string;
    controller?: string;
    handler?: string;
    pipeline?: string;
    file?: string;
    method?: string;
    stage?: string;
    purpose?: string;
    dtoType?: string;
    collection?: string;
    slug?: string;
    version?: string | number;
    line?: number;
    column?: number;
  };
};

type FirstFrame = {
  frame: string;
  file?: string;
  line?: number;
  column?: number;
  functionName?: string;
};

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
   * Framework entrypoint called by controllers.
   * - Short-circuits on prior failure unless canRunAfterError() is true.
   * - Wraps execute() in a generic try/catch that records a structured
   *   UNHANDLED_HANDLER_EXCEPTION on ctx["error"].
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
      // Throwing from a handler without its own catch is serious enough
      // that we always surface a structured internal error here.
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
   * - Reads ONLY from ControllerBase.getSvcEnv().getVar(key).
   * - Never falls back to process.env or ctx.
   * - When required=false (default):
   *     • Logs WARN if svcEnv/getVar is unavailable or value is missing/empty.
   *     • Returns undefined.
   * - When required=true:
   *     • Logs ERROR with the missing key and svcEnv context.
   *     • Throws Error("[EnvVarMissing] Required svc env var '<key>' is missing or empty").
   *
   * This keeps minters and other critical rails strict, while allowing
   * callers to probe optional vars without blowing up the handler.
   */
  protected getVar(key: string): string | undefined;
  protected getVar(key: string, required: false): string | undefined;
  protected getVar(key: string, required: true): string;
  protected getVar(key: string, required: boolean = false): string | undefined {
    const svcEnv: unknown = (this.controller as any)?.getSvcEnv?.();

    let value: string | undefined;

    try {
      const svcEnvAny = svcEnv as any;
      const hasGetter = svcEnvAny && typeof svcEnvAny.getVar === "function";

      if (!hasGetter) {
        const payload = {
          event: required
            ? "getVar_no_svcenv_required"
            : "getVar_no_svcenv_optional",
          handler: this.constructor.name,
          key,
          hasSvcEnv: !!svcEnv,
        };

        if (required) {
          this.log.error(
            payload,
            `getVar('${key}', true) — svcEnv or getVar() missing`
          );
          throw new Error(
            `[EnvVarMissing] Required svc env var '${key}' is missing (no svcEnv/getVar).`
          );
        } else {
          this.log.warn(
            payload,
            `getVar('${key}') — svcEnv or getVar() missing`
          );
          return undefined;
        }
      }

      // IMPORTANT: call getVar with the correct `this` binding
      value = svcEnvAny.getVar(key);
    } catch (err) {
      const payload = {
        event: required
          ? "getVar_getter_threw_required"
          : "getVar_getter_threw_optional",
        handler: this.constructor.name,
        key,
        hasSvcEnv: !!svcEnv,
        error: err instanceof Error ? err.message : String(err),
      };

      if (required) {
        this.log.error(
          payload,
          `getVar('${key}', true) — svcEnv.getVar() threw`
        );
        throw new Error(
          `[EnvVarMissing] Required svc env var '${key}' could not be read (getter threw).`
        );
      } else {
        this.log.warn(
          payload,
          `getVar('${key}') — svcEnv.getVar() threw; returning undefined`
        );
        return undefined;
      }
    }

    const trimmed = typeof value === "string" ? value.trim() : "";

    if (trimmed === "") {
      const payload = {
        event: required ? "getVar_missing_required" : "getVar_missing_optional",
        handler: this.constructor.name,
        key,
        hasSvcEnv: !!svcEnv,
      };

      if (required) {
        this.log.error(
          payload,
          `getVar('${key}', true) — required svc env var missing or empty`
        );
        throw new Error(
          `[EnvVarMissing] Required svc env var '${key}' is missing or empty`
        );
      } else {
        this.log.warn(
          payload,
          `getVar('${key}') — optional svc env var missing or empty`
        );
        return undefined;
      }
    }

    return trimmed;
  }

  /**
   * Best-effort ctx.get() for error/telemetry context.
   * - Never throws.
   * - Logs at debug if something weird happens.
   */
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

  /**
   * Best-effort, normalized requestId string for logging and errors.
   * - Reads via safeCtxGet("requestId").
   * - Guarantees a non-empty string; falls back to "unknown".
   * - Never throws.
   */
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

  /**
   * Best-effort service slug for error context.
   * - Tries app.getSlug() if present.
   * - Falls back to ctx["slug"].
   * - Never throws.
   */
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

  /** Best-effort dtoType for error context. */
  protected safeDtoType(): string | undefined {
    return this.safeCtxGet<string>("dtoType");
  }

  /** Best-effort pipeline label for error context. */
  protected safePipeline(): string | undefined {
    return this.safeCtxGet<string>("pipeline");
  }

  /**
   * Build a structured NvHandlerError object from the supplied fields.
   * Does NOT log or touch ctx; callers decide how to use the error.
   */
  protected buildHandlerError(input: {
    httpStatus: number;
    title: string;
    detail: string;
    requestId?: string;
    promptKey?: string;
    issues?: unknown[];
    origin?: Partial<NvHandlerError["origin"]>;
  }): NvHandlerError {
    const handlerName = this.constructor.name;

    return {
      httpStatus: input.httpStatus,
      title: input.title,
      detail: input.detail,
      requestId: input.requestId,
      promptKey: input.promptKey,
      issues: input.issues,
      origin: {
        handler: handlerName,
        purpose: this.handlerPurpose(),
        ...(input.origin ?? {}),
      },
    };
  }

  /**
   * High-level helper for use in handler try/catch blocks:
   * - Derives requestId from ctx if not supplied.
   * - Extracts first stack frame (file/line/column/function) from rawError, if present.
   * - Enriches origin with pipeline/dtoType/slug when not supplied by caller.
   * - Calls buildHandlerError() to construct NvHandlerError, augmenting origin with firstFrame data.
   * - Logs with structured origin.
   * - Writes ctx["error"], ctx["handlerStatus"] = "error", ctx["status"] = httpStatus.
   *
   * Returns the NvHandlerError in case callers want to propagate or inspect it.
   */
  protected failWithError(input: {
    httpStatus: number;
    title: string;
    detail: string;
    stage?: string;
    requestId?: string;
    promptKey?: string;
    issues?: unknown[];
    origin?: Partial<NvHandlerError["origin"]>;
    rawError?: unknown; // original thrown value, for logs only
    logMessage?: string; // override log message
    logLevel?: "error" | "warn" | "info" | "debug";
  }): NvHandlerError {
    const requestId = input.requestId ?? this.safeCtxGet<string>("requestId");

    const firstFrame = this.extractFirstStackFrame(input.rawError);

    // Start from caller-supplied origin (if any)
    const mergedOrigin: NvHandlerError["origin"] = {
      ...(input.origin ?? {}),
      stage: input.stage ?? input.origin?.stage,
    };

    // Best-effort context from rails, but only if caller didn't set them
    if (!mergedOrigin.pipeline) {
      mergedOrigin.pipeline = this.safePipeline();
    }
    if (!mergedOrigin.dtoType) {
      mergedOrigin.dtoType = this.safeDtoType();
    }
    if (!mergedOrigin.slug) {
      mergedOrigin.slug = this.safeServiceSlug();
    }
    if (!mergedOrigin.service && mergedOrigin.slug) {
      mergedOrigin.service = mergedOrigin.slug;
    }

    // First-frame location enrichment (file/line/column/method)
    if (firstFrame) {
      if (!mergedOrigin.file && firstFrame.file) {
        mergedOrigin.file = firstFrame.file;
      }
      if (!mergedOrigin.method && firstFrame.functionName) {
        mergedOrigin.method = firstFrame.functionName;
      }
      if (mergedOrigin.line === undefined && firstFrame.line !== undefined) {
        mergedOrigin.line = firstFrame.line;
      }
      if (
        mergedOrigin.column === undefined &&
        firstFrame.column !== undefined
      ) {
        mergedOrigin.column = firstFrame.column;
      }
    }

    const error = this.buildHandlerError({
      httpStatus: input.httpStatus,
      title: input.title,
      detail: input.detail,
      requestId,
      promptKey: input.promptKey,
      issues: input.issues,
      origin: mergedOrigin,
    });

    const logPayload: Record<string, unknown> = {
      event: "handler_fail",
      handler: this.constructor.name,
      requestId,
      httpStatus: error.httpStatus,
      origin: error.origin,
    };

    if (firstFrame) {
      logPayload.firstFrame = firstFrame;
    }

    if (input.rawError) {
      if (input.rawError instanceof Error) {
        logPayload.rawError = {
          name: input.rawError.name,
          message: input.rawError.message,
        };
      } else {
        logPayload.rawError = input.rawError;
      }
    }

    const msg =
      input.logMessage ??
      `Handler failure in ${error.origin?.handler ?? "unknown handler"}`;

    const level = input.logLevel ?? "error";
    if (level === "debug") {
      this.log.debug(logPayload, msg);
    } else if (level === "info") {
      this.log.info(logPayload, msg);
    } else if (level === "warn") {
      this.log.warn(logPayload, msg);
    } else {
      this.log.error(logPayload, msg);
    }

    // Record the error on the context. We intentionally allow newer, more
    // specific errors from later handlers to overwrite generic ones.
    this.ctx.set("error", error);
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("status", error.httpStatus);

    return error;
  }

  /**
   * Extract the first useful stack frame from a rawError (if any),
   * parsing file, line, column, and function name where possible.
   *
   * Example stack lines we handle:
   *   at SomeHandler.execute (/path/to/file.js:87:24)
   *   at /path/to/file.js:87:24
   */
  private extractFirstStackFrame(rawError: unknown): FirstFrame | undefined {
    if (!(rawError instanceof Error)) return undefined;
    const stack = rawError.stack;
    if (!stack || typeof stack !== "string") return undefined;

    const lines = stack.split("\n").map((l) => l.trim());
    const frameLine = lines.find((l) => l.startsWith("at "));
    if (!frameLine) return undefined;

    // Patterns:
    // 1) at FunctionName (path:line:column)
    // 2) at path:line:column
    const withFunc =
      /^at\s+(?<fn>.+?)\s+\((?<file>.+):(?<line>\d+):(?<col>\d+)\)$/;
    const noFunc = /^at\s+(?<file>.+):(?<line>\d+):(?<col>\d+)$/;

    let match = frameLine.match(withFunc);
    if (match && match.groups) {
      const { fn, file, line, col } = match.groups;
      return {
        frame: frameLine,
        functionName: fn,
        file,
        line: Number(line),
        column: Number(col),
      };
    }

    match = frameLine.match(noFunc);
    if (match && match.groups) {
      const { file, line, col } = match.groups;
      return {
        frame: frameLine,
        file,
        line: Number(line),
        column: Number(col),
      };
    }

    // Fallback: we at least return the raw frame text.
    return {
      frame: frameLine,
    };
  }

  protected abstract execute(): Promise<void>;
}
