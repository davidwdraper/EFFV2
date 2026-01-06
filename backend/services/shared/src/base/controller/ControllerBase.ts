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

  public setActivePipeline(p: PipelineBase | undefined): void {
    this._activePipeline = p;
  }

  public tryGetActivePipeline(): PipelineBase | undefined {
    return this._activePipeline;
  }

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

  public getDtoRegistry(): IDtoRegistry {
    return this.app.getDtoRegistry();
  }

  public tryGetDtoRegistry(): IDtoRegistry | undefined {
    try {
      return this.app.getDtoRegistry();
    } catch {
      return undefined;
    }
  }

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

  public needsRegistry(): boolean {
    return true;
  }

  protected abstract finalize(ctx: HandlerContext): Promise<void>;
}
