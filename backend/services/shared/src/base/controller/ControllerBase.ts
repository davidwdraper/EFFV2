// backend/services/shared/src/base/controller/ControllerBase.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (DTO Hydration & Failure Propagation)
 * - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 * - ADR-0049 (DTO Registry & Wire Discrimination)
 * - ADR-0050 (Wire Bag Envelope; bag-only edges)
 * - ADR-0059 (dtoType and dbCollectionName addition to handler ctx)
 * - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *
 * Purpose:
 * - Shared abstract controller base for all services.
 * - Orchestrates context seeding, preflight, pipeline execution, and finalize()
 *   using helpers in this folder.
 *
 * Notes:
 * - Success responses are always built from ctx["bag"] (DtoBag) only.
 * - Error responses are normalized to Problem+JSON (see controllerFinalize.ts).
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
import { finalizeResponse } from "./controllerFinalize";

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
    const reg = (this.app as any)?.getDtoRegistry?.();
    if (!reg) {
      throw new Error("DtoRegistry not available from AppBase.");
    }
    return reg as IDtoRegistry;
  }

  public getSvcEnv(): EnvServiceDto {
    const env = (this.app as any)?.svcEnv;
    if (!env) {
      throw new Error("EnvServiceDto not available from AppBase.");
    }
    return env as EnvServiceDto;
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

  protected makeContext(req: Request, res: Response): HandlerContext {
    return makeHandlerContext(this, req, res);
  }

  protected makeDtoOpContext(
    req: Request,
    res: Response,
    op: string,
    opts?: { resolveCollectionName?: boolean }
  ): HandlerContext {
    return makeDtoOpHandlerContext(this, req, res, op, opts);
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
  // Finalize (bag-or-error)
  // ───────────────────────────────────────────

  protected async finalize(ctx: HandlerContext): Promise<void> {
    await finalizeResponse(this, ctx);
  }

  /**
   * Whether this controller needs a DTO registry.
   * Public so controller helpers (ControllerRuntimeDeps) can depend on it.
   * Override in subclasses if a controller does not require a registry.
   */
  public needsRegistry(): boolean {
    return true;
  }
}

export type { ProblemJson } from "./controllerTypes";
