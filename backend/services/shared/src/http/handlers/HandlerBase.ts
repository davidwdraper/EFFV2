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
 * - getVar() reads only from ControllerBase.getSvcEnv()._vars
 *   (never from ctx or process.env)
 */

import { HandlerContext } from "./HandlerContext";
import { getLogger, type IBoundLogger } from "../../logger/Logger";
import type { AppBase } from "../../base/app/AppBase";
import type { IDtoRegistry } from "../../registry/RegistryBase";
import type { ControllerBase } from "../../base/controller/ControllerBase";

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
    if (!app)
      throw new Error("ControllerBase.getApp() returned null/undefined.");
    this.app = app;

    const registry = controller.getDtoRegistry?.();
    if (!registry)
      throw new Error(
        "ControllerBase.getDtoRegistry() returned null/undefined."
      );
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

    this.log.debug(
      {
        event: "construct",
        handlerStatus: this.ctx.get<string>("handlerStatus") ?? "ok",
        strict: true,
      },
      "HandlerBase ctor"
    );
  }

  /** Framework entrypoint called by controllers */
  public async run(): Promise<void> {
    const status = this.ctx.get<number>("status");
    const handlerStatus = this.ctx.get<string>("handlerStatus");

    if ((status && status >= 400) || handlerStatus === "error") {
      this.log.debug(
        { event: "short_circuit", reason: "prior_failure" },
        "No-op after failure"
      );
      return;
    }

    this.log.debug({ event: "execute_start" }, "Handler execute() start");

    try {
      await this.execute();
    } catch (err) {
      this.log.debug(
        {
          event: "execute_catch",
          error: (err as Error)?.message ?? String(err),
        },
        "Handler threw"
      );
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "HANDLER_ERROR",
        message: (err as Error)?.message ?? "Unhandled handler error",
      });
    }

    this.log.debug({ event: "execute_end" }, "Handler execute() end");
  }

  /**
   * Strict accessor for per-service environment variables.
   * - Reads from ControllerBase.getSvcEnv()._vars only.
   * - Logs WARN if the key or vars bag is missing.
   * - Never falls back to process.env or ctx.
   */
  protected getVar(key: string): string | undefined {
    const svcEnv = (this.controller as any)?.getSvcEnv?.();
    const vars = svcEnv?._vars as Record<string, unknown> | undefined;

    if (!svcEnv || !vars || typeof vars !== "object") {
      this.log.warn(
        {
          event: "getVar_no_vars",
          handler: this.constructor.name,
          key,
          hasSvcEnv: !!svcEnv,
          svcEnvSlug: svcEnv?.slug,
          svcEnvEnv: svcEnv?.env,
          svcEnvVersion: svcEnv?.version,
        },
        `getVar('${key}') — svcEnv or _vars missing`
      );
      return undefined;
    }

    const val = vars[key];
    if (typeof val === "string" && val.trim() !== "") {
      return val;
    }

    this.log.warn(
      {
        event: "getVar_missing",
        handler: this.constructor.name,
        key,
        svcEnvSlug: svcEnv?.slug,
        svcEnvEnv: svcEnv?.env,
        svcEnvVersion: svcEnv?.version,
        varsKeys: Object.keys(vars),
      },
      `getVar('${key}') — key missing or empty`
    );
    return undefined;
  }

  protected abstract execute(): Promise<void>;
}
