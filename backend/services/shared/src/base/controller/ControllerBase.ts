// backend/services/shared/src/base/controller/ControllerBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Hydration + Failure Propagation)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *   - ADR-0099 (Handler test manifest from handlers)
 *
 * Purpose:
 * - Shared abstract controller base for all services.
 * - Owns the app reference and exposes strictly-scoped accessors.
 * - Orchestrates context seeding, preflight, and pipeline execution.
 *
 * Hard contract:
 * - SvcRuntime is mandatory; controllers always seed ctx["rt"].
 * - ctx["svcEnv"] never exists (deleted).
 */

import type { Request, Response } from "express";
import type { AppBase } from "../app/AppBase";
import type { IBoundLogger } from "../../logger/Logger";
import type { IDtoRegistry } from "../../registry/RegistryBase";
import type { SvcRuntime } from "../../runtime/SvcRuntime";
import { HandlerContext } from "../../http/handlers/HandlerContext";
import type { HandlerBase } from "../../http/handlers/HandlerBase";
import {
  seedHydratorIntoContext,
  makeHandlerContext,
  makeDtoOpHandlerContext,
  preflightContext,
  runPipelineHandlers,
} from "./controllerContext";
import type { PipelineBase } from "../pipeline/PipelineBase";

export abstract class ControllerBase {
  protected readonly app: AppBase;

  /**
   * ADR-0099:
   * - Active pipeline pointer for metadata recording during handler construction.
   * - This is NOT HandlerContext state.
   * - It is cleared immediately after pipeline step construction.
   */
  private _activePipeline?: PipelineBase;

  public constructor(app: AppBase) {
    this.app = app;
  }

  public getApp(): AppBase {
    return this.app;
  }

  public getLogger(): IBoundLogger {
    return this.app.getLogger();
  }

  /**
   * ADR-0099: pipeline wiring hook
   * - Pipelines set this before constructing steps.
   * - Handlers read it during construction to register handlerTestName().
   */
  public setActivePipeline(p: PipelineBase | undefined): void {
    this._activePipeline = p;
  }

  /** ADR-0099: handler-side safe peek. */
  public tryGetActivePipeline(): PipelineBase | undefined {
    return this._activePipeline;
  }

  /**
   * Runtime accessor (required).
   *
   * Why:
   * - HandlerBase requires controller.getRuntime().
   * - Controllers seed ctx['rt'] for diagnostics + downstream helpers.
   */
  public getRuntime(): SvcRuntime {
    const anyApp = this.app as any;
    const rt =
      typeof anyApp.getRuntime === "function" ? anyApp.getRuntime() : undefined;

    if (!rt) {
      throw new Error(
        `SVC_RUNTIME_NOT_AVAILABLE: service="${
          anyApp.getServiceSlug?.() ?? "unknown"
        }" v${anyApp.getServiceVersion?.() ?? 1} ` +
          "does not provide SvcRuntime. Dev: wire SvcRuntime during app boot (ADR-0080)."
      );
    }

    return rt as SvcRuntime;
  }

  /**
   * Strict registry accessor (DB/API/FS posture only).
   *
   * Notes:
   * - This will throw for MOS/gateway services by design (AppBase guardrail).
   */
  public getDtoRegistry(): IDtoRegistry {
    return this.app.getDtoRegistry();
  }

  /** Soft registry accessor (allowed for MOS). */
  public tryGetDtoRegistry(): IDtoRegistry | undefined {
    try {
      return this.app.getDtoRegistry();
    } catch {
      return undefined;
    }
  }

  // ───────────────────────────────────────────
  // Context prep helpers (shared)
  // ───────────────────────────────────────────

  protected seedHydrator(
    ctx: HandlerContext,
    dtoType: string,
    opts?: { validate?: boolean }
  ): void {
    seedHydratorIntoContext(this as any, ctx, dtoType, opts);
  }

  protected makeContext(req: Request, res: Response): HandlerContext {
    return makeHandlerContext(this as any, req, res);
  }

  protected makeDtoOpContext(
    req: Request,
    res: Response,
    op: string,
    opts?: { resolveCollectionName?: boolean }
  ): HandlerContext {
    return makeDtoOpHandlerContext(this as any, req, res, op, opts);
  }

  protected preflight(
    ctx: HandlerContext,
    opts?: { requireRegistry?: boolean }
  ): void {
    preflightContext(this as any, ctx, opts);
  }

  protected async runPipeline(
    ctx: HandlerContext,
    handlers: HandlerBase[],
    opts?: { requireRegistry?: boolean }
  ): Promise<void> {
    await runPipelineHandlers(this as any, ctx, handlers, opts);
  }

  // Default posture expectation; services can override if they truly don’t have one.
  public needsRegistry(): boolean {
    return true;
  }

  // Finalize hook is wire-format specific (Json/Html/etc.)
  protected abstract finalize(ctx: HandlerContext): Promise<void>;
}
