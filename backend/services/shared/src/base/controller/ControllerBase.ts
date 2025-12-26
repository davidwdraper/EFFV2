// backend/services/shared/src/base/controller/ControllerBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0041 (Controller & Handler Architecture)
 *   - ADR-0042 (HandlerContext Bus)
 *   - ADR-0043 (DTO Hydration & Failure Propagation)
 *   - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope; bag-only edges)
 *   - ADR-0059 (dtoType and dbCollectionName addition to handler ctx)
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *   - ADR-0069 (Multi-Format Controllers & DTO Body Semantics)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Shared abstract controller base for all services.
 * - Orchestrates context seeding, preflight, and pipeline execution.
 *
 * Invariants:
 * - SvcRuntime is mandatory; controllers always seed ctx["rt"].
 * - No transitional trySandbox() paths.
 * - No legacy env DTO fallback paths (app.svcEnv).
 */

import type { Request, Response } from "express";
import { HandlerContext } from "../../http/handlers/HandlerContext";
import type { HandlerBase } from "../../http/handlers/HandlerBase";
import { getLogger, type IBoundLogger } from "../../logger/Logger";
import type { EnvServiceDto } from "../../dto/env-service.dto";
import type { AppBase } from "../app/AppBase";
import type { IDtoRegistry } from "../../registry/RegistryBase";
import {
  seedHydratorIntoContext,
  makeHandlerContext,
  makeDtoOpHandlerContext,
  preflightContext,
  runPipelineHandlers,
} from "./controllerContext";
import type { SvcRuntime } from "../../runtime/SvcRuntime";

export abstract class ControllerBase {
  protected readonly app: AppBase;
  protected readonly log!: IBoundLogger; // definite assignment OK

  constructor(app: AppBase) {
    this.app = app;

    const appLog = (app as any)?.log as IBoundLogger | undefined;
    this.log =
      appLog?.bind({ component: "ControllerBase" }) ??
      getLogger({ service: "shared", component: "ControllerBase" });

    this.log.debug(
      { event: "construct", hasApp: !!app },
      "ControllerBase ctor"
    );
  }

  // ───────────────────────────────────────────
  // Public getters
  // ───────────────────────────────────────────

  public getApp(): AppBase {
    return this.app;
  }

  public getDtoRegistry(): IDtoRegistry {
    // Commit 1: no probing, no fallback, no "any".
    return this.app.getDtoRegistry();
  }

  /**
   * Sandbox access (ADR-0080).
   *
   * Invariant:
   * - AppBase MUST expose getSandbox() and it MUST succeed.
   * - No try-paths, no compatibility shims.
   */
  public getSandbox(): SvcRuntime {
    return this.app.getSandbox();
  }

  /**
   * EnvServiceDto accessor for controllers/handlers.
   *
   * Invariants:
   * - Env DTO is owned by AppBase.
   * - Preferred access is via AppBase.getSvcEnv().
   * - Commit 1: legacy app.svcEnv compatibility path is removed.
   */
  public getSvcEnv(): EnvServiceDto {
    return this.app.getSvcEnv();
  }

  public getEnvLabel(): string {
    const envLabel = this.app.getEnvLabel();

    if (!envLabel || typeof envLabel !== "string" || !envLabel.trim()) {
      throw new Error(
        "Environment label missing on AppBase. " +
          "Expected AppBase.getEnvLabel() to return a non-empty string."
      );
    }

    return envLabel;
  }

  public getLogger(): IBoundLogger {
    return this.log;
  }

  // ───────────────────────────────────────────
  // Context prep helpers
  // ───────────────────────────────────────────

  protected seedHydrator(
    ctx: HandlerContext,
    dtoType: string,
    opts?: { validate?: boolean }
  ): void {
    seedHydratorIntoContext(this, ctx, dtoType, opts);
  }

  private seedSandboxIntoContext(ctx: HandlerContext): void {
    const rt = this.getSandbox(); // mandatory (will throw if missing)
    ctx.set("rt", rt);
  }

  protected makeContext(req: Request, res: Response): HandlerContext {
    const ctx = makeHandlerContext(this, req, res);
    this.seedSandboxIntoContext(ctx);
    return ctx;
  }

  protected makeDtoOpContext(
    req: Request,
    res: Response,
    op: string,
    opts?: { resolveCollectionName?: boolean }
  ): HandlerContext {
    const ctx = makeDtoOpHandlerContext(this, req, res, op, opts);
    this.seedSandboxIntoContext(ctx);
    return ctx;
  }

  protected preflight(
    ctx: HandlerContext,
    opts?: { requireRegistry?: boolean }
  ): void {
    preflightContext(this, ctx, opts);
  }

  protected async runPipeline(
    ctx: HandlerContext,
    handlers: HandlerBase[],
    opts?: { requireRegistry?: boolean }
  ): Promise<void> {
    await runPipelineHandlers(this, ctx, handlers, opts);
  }

  // ───────────────────────────────────────────
  // Finalize hook (bag-or-error)
  // ───────────────────────────────────────────

  protected abstract finalize(ctx: HandlerContext): Promise<void>;

  public needsRegistry(): boolean {
    return true;
  }

  // ───────────────────────────────────────────
  // Finalize-time logging policy (format-agnostic)
  // ───────────────────────────────────────────

  protected isExpectedErrorContext(ctx: HandlerContext): boolean {
    try {
      const b1 = ctx.get<boolean>("test.expectedError");
      if (b1 === true) return true;

      const b2 = ctx.get<boolean>("test.isNegative");
      if (b2 === true) return true;

      const b3 = ctx.get<boolean>("testRun.expectedError");
      if (b3 === true) return true;

      const b4 = ctx.get<boolean>("runner.expectedError");
      if (b4 === true) return true;
    } catch {
      // ignore
    }

    try {
      const appAny = this.app as any;
      const hook = appAny?.isExpectedErrorContext;
      if (typeof hook === "function") {
        const r = hook.call(appAny, ctx);
        if (r === true) return true;
      }
    } catch {
      // ignore
    }

    return false;
  }

  protected logFinalizeError(opts: {
    ctx: HandlerContext;
    requestId: string;
    status: number;
    body: unknown;
    event?: string;
    messageError?: string;
    messageExpected?: string;
  }): void {
    const { ctx, requestId, status, body } = opts;

    const event = opts.event ?? "finalize_error";
    const msgError = opts.messageError ?? "ControllerBase error response";
    const msgExpected =
      opts.messageExpected ??
      "ControllerBase expected error response (negative test)";

    if (status < 500) {
      this.log.warn(
        {
          event: "finalize_client_error",
          requestId,
          status,
          problem: body,
        },
        msgError
      );
      return;
    }

    const expected = this.isExpectedErrorContext(ctx);

    if (expected) {
      this.log.warn(
        {
          event,
          requestId,
          status,
          expectedError: true,
          problem: body,
        },
        msgExpected
      );
      return;
    }

    this.log.error(
      {
        event,
        requestId,
        status,
        expectedError: false,
        problem: body,
      },
      msgError
    );
  }
}

export type { ProblemJson } from "./controllerTypes";
