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
 *
 * Purpose:
 * - Shared abstract controller base for all services.
 * - Orchestrates context seeding, preflight, and pipeline execution
 *   using helpers in this folder.
 *
 * Notes:
 * - finalize() is now an abstract hook implemented by concrete
 *   controller bases (JSON, HTML, streaming, etc.).
 * - Success responses must still be built from ctx["bag"] (DtoBag) only;
 *   concrete subclasses enforce the wire format.
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

  /**
   * EnvServiceDto accessor for controllers/handlers.
   *
   * Invariants:
   * - Env DTO is owned by AppBase.
   * - Preferred access is via AppBase.getSvcEnv().
   * - Legacy direct field access (app.svcEnv) is supported as a temporary
   *   compatibility path, but should be removed once all apps expose
   *   getSvcEnv().
   */
  public getSvcEnv(): EnvServiceDto {
    const appAny = this.app as any;
    const envDto = (
      typeof appAny.getSvcEnv === "function"
        ? appAny.getSvcEnv()
        : appAny.svcEnv
    ) as EnvServiceDto | undefined;

    if (!envDto) {
      throw new Error(
        "EnvServiceDto not available from AppBase. " +
          "Ops/Dev: ensure AppBase is constructed with a concrete EnvServiceDto " +
          "and exposes it via getSvcEnv()."
      );
    }

    return envDto;
  }

  /**
   * Runtime environment label accessor.
   *
   * Invariants:
   * - Single source of truth is AppBase (constructed from EN_ENV at boot).
   * - Controllers use this to seed env into HandlerContext; handlers should
   *   not read process.env directly.
   *
   * Expected AppBase surface:
   *   - getEnvLabel(): string  // derived from EN_ENV
   */
  public getEnvLabel(): string {
    const appAny = this.app as any;
    const envLabel = appAny.getEnvLabel?.() as string | undefined;

    if (!envLabel || typeof envLabel !== "string" || !envLabel.trim()) {
      throw new Error(
        "Environment label missing on AppBase. " +
          "Expected AppBase.getEnvLabel() to return a non-empty string " +
          'derived from EN_ENV (e.g., "dev", "stage", "prod").'
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
  // Finalize hook (bag-or-error)
  // ───────────────────────────────────────────

  /**
   * Finalize the HTTP response from the populated HandlerContext.
   *
   * Concrete subclasses (e.g., ControllerJsonBase, ControllerHtmlBase)
   * must implement this and:
   * - Build success responses strictly from ctx["bag"] (DtoBag).
   * - Normalize errors into their chosen wire format.
   */
  protected abstract finalize(ctx: HandlerContext): Promise<void>;

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
