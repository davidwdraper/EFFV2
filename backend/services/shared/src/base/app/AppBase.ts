// backend/services/shared/src/base/app/AppBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope; versioned health routes)
 *   - ADR-0032 (RoutePolicyGate — version-agnostic enforcement; health bypass)
 *   - ADR-0039 (env-service centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *   - ADR-0072 (Edge Mode Factory — Root Env Switches)
 *
 * Purpose:
 * - Orchestrator for Express composition across ALL services.
 * - Delegates concrete concerns (boot, health, middleware, S2S clients, prompts)
 *   into focused helpers in this folder.
 * - Holds the resolved EdgeMode (prod / future mock modes) as a boot-time decision
 *   so downstream wiring can choose appropriate edge helpers (DbWriter, DbReader, etc.)
 *   without re-reading env on each call.
 */

import type { Express } from "express";
import express = require("express");
import { ServiceBase } from "@nv/shared/base/ServiceBase";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import { PromptsClient } from "@nv/shared/prompts/PromptsClient";
import { SvcClient } from "@nv/shared/s2s/SvcClient";
import type { IBoundLogger } from "@nv/shared/logger/Logger";
import { performDbBoot, type DbBootContext } from "./appBoot";
import {
  mountPreRoutingLayer,
  mountRoutePolicyGateLayer,
  mountParserLayer,
  mountPostRoutingLayer,
} from "./appMiddleware";
import {
  computeHealthBasePath,
  mountVersionedHealthRoute,
  mountEnvReloadRoute,
} from "./appHealth";
import { createSvcClientForApp, createPromptsClientForApp } from "./appClients";
// NOTE: AppBase lives in shared, so use a relative import for EdgeMode.
import { EdgeMode } from "../../env/edgeModeFactory";

export type AppBaseCtor = {
  service: string;
  version: number;
  /**
   * Logical environment label for this service instance (e.g., "dev", "stage", "prod").
   * - Optional: if omitted, derived from EnvServiceDto.getEnvLabel().
   */
  envLabel?: string;
  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;
  checkDb: boolean;
  /**
   * Effective edge mode for this process:
   * - EdgeMode.Prod      => production edge helpers
   * - EdgeMode.FullMock  => future full-mock mode
   * - EdgeMode.DbMock    => future DB-mock mode
   *
   * NOTE:
   * - This is intended to be resolved once at boot (e.g., from the root
   *   "service-root" env-service record via the edgeModeFactory) and then
   *   treated as immutable for the lifetime of the process.
   * - If omitted, AppBase defaults to EdgeMode.Prod.
   */
  edgeMode?: EdgeMode;
};

export abstract class AppBase extends ServiceBase {
  protected readonly app: Express;
  private _booted = false;

  protected readonly version: number;

  /**
   * Logical environment label for this service instance.
   * Source of truth: explicit ctor value when provided, otherwise derived from EnvServiceDto.
   */
  private readonly envLabel: string;

  private _envDto: EnvServiceDto;
  private readonly envReloader: () => Promise<EnvServiceDto>;

  protected readonly checkDb: boolean;

  protected readonly svcClient: SvcClient;
  protected readonly promptsClient: PromptsClient;

  /**
   * Effective edge mode for this process (resolved at boot).
   * - For now, all services should run with EdgeMode.Prod behavior; non-prod
   *   modes will be wired in via follow-up ADRs.
   */
  private readonly edgeMode: EdgeMode;

  constructor(opts: AppBaseCtor) {
    super({ service: opts.service });

    this.version = opts.version;
    this._envDto = opts.envDto;
    this.envReloader = opts.envReloader;
    this.checkDb = opts.checkDb;

    // Logical environment label: prefer explicit ctor value, otherwise derive from EnvServiceDto.
    const labelFromDto = this._envDto.getEnvLabel();
    this.envLabel = opts.envLabel ?? labelFromDto;

    // Edge mode is a boot-time decision. If not provided, default to production behavior.
    this.edgeMode = opts.edgeMode ?? EdgeMode.Prod;

    this.app = express();
    this.initApp();

    this.svcClient = createSvcClientForApp({
      service: this.service,
      version: this.version,
      log: this.log,
    });

    this.promptsClient = createPromptsClientForApp({
      service: this.service,
      log: this.log,
      svcClient: this.svcClient,
      getEnvLabel: () => this.getEnvLabel(),
      // requestId correlation can later be wired via per-request context.
      getRequestId: undefined,
    });
  }

  /** Disable noisy headers; keep this minimal. */
  protected initApp(): void {
    this.app.disable("x-powered-by");
  }

  /** Current environment DTO (protected for subclasses). */
  protected get envDto(): EnvServiceDto {
    return this._envDto;
  }

  /** Public accessor for the EnvServiceDto instance. */
  public get svcEnv(): EnvServiceDto {
    return this._envDto;
  }

  /** Public accessor for the bound logger singleton owned by this app. */
  public getLogger(): IBoundLogger {
    return this.log;
  }

  /** PromptsClient accessor for advanced usage. */
  public getPromptsClient(): PromptsClient {
    return this.promptsClient;
  }

  /** SvcClient accessor for S2S calls. */
  public getSvcClient(): SvcClient {
    return this.svcClient;
  }

  /** Convenience wrapper around PromptsClient.render(). */
  public async prompt(
    language: string,
    promptKey: string,
    params?: Record<string, string | number>,
    meta: Record<string, unknown> = {}
  ): Promise<string> {
    return this.promptsClient.render(language, promptKey, params, meta);
  }

  /**
   * Runtime environment label accessor.
   * Controllers should always call this to fetch the environment tag.
   */
  public getEnvLabel(): string {
    return this.envLabel;
  }

  /**
   * Effective edge mode accessor.
   * - Downstream wiring (DbWriter/DbReader/DbDeleter, SvcClient variants, etc.)
   *   should use this to decide which concrete helpers to construct.
   * - This value is resolved once at boot and remains immutable for the
   *   lifetime of the process.
   */
  public getEdgeMode(): EdgeMode {
    return this.edgeMode;
  }

  /** DTO Registry accessor – concrete services MUST implement. */
  public abstract getDtoRegistry(): IDtoRegistry;

  /** Optional svcconfig resolver hook. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected getSvcconfigResolver():
    | import("@nv/shared/middleware/policy/routePolicyGate").ISvcconfigResolver
    | null {
    return null;
  }

  /** Versioned health base like `/api/<slug>/v<major>`. */
  protected healthBasePath(): string | null {
    return computeHealthBasePath(this.service, this.version);
  }

  /** Async lifecycle entry – MUST be awaited before using `instance`. */
  public async boot(): Promise<void> {
    if (this._booted) return;

    await this.onBoot();

    const base = this.healthBasePath();
    if (base) {
      mountVersionedHealthRoute({
        app: this.app,
        base,
        service: this.service,
        version: this.version,
        envLabel: this.envLabel,
        log: this.log,
        readyCheck: this.readyCheck(),
      });

      mountEnvReloadRoute({
        app: this.app,
        base,
        log: this.log,
        envLabel: this.envLabel,
        getEnvDto: () => this._envDto,
        setEnvDto: (fresh) => {
          this._envDto = fresh;
        },
        envReloader: this.envReloader,
      });
    }

    mountPreRoutingLayer({
      app: this.app,
      service: this.service,
    });

    mountRoutePolicyGateLayer({
      app: this.app,
      service: this.service,
      log: this.log,
      resolver: this.getSvcconfigResolver(),
      envLabel: this.envLabel,
    });

    this.mountSecurity();

    mountParserLayer({ app: this.app });

    this.mountRoutes();

    mountPostRoutingLayer({
      app: this.app,
      service: this.service,
      envLabel: this.envLabel,
      log: this.log,
    });

    this._booted = true;
    this.log.info(
      {
        service: this.service,
        envLabel: this.envLabel,
        edgeMode: this.edgeMode,
      },
      "app booted"
    );
  }

  // ─────────────── Hooks (override sparingly) ───────────────

  /** Boot hook – delegates DB ensure to shared helper. */
  protected async onBoot(): Promise<void> {
    const ctx: DbBootContext = {
      service: this.service,
      component: this.constructor.name,
      envLabel: this.envLabel,
      checkDb: this.checkDb,
      envDto: this._envDto,
      log: this.log,
      registry: this.getDtoRegistry(),
    };
    await performDbBoot(ctx);
  }

  /** Optional readiness function. */
  protected readyCheck(): (() => boolean | Promise<boolean>) | undefined {
    return undefined;
  }

  /** Security layer (verifyS2S, CORS, rate limits…). Default: no-op. */
  protected mountSecurity(): void {}

  /** Service routes – MUST be implemented by concrete service. */
  protected abstract mountRoutes(): void;

  /** Express instance after boot. */
  public get instance(): Express {
    if (!this._booted) {
      throw new Error(
        `[${this.service}] App not booted. Call and await app.boot() before using instance.`
      );
    }
    return this.app;
  }
}
