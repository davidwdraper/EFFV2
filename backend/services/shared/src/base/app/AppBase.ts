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
 *
 * Purpose:
 * - Orchestrator for Express composition across ALL services.
 * - Delegates concrete concerns (boot, health, middleware, S2S clients, prompts)
 *   into focused helpers in this folder.
 */

import type { Express } from "express";
import express = require("express");
import { ServiceBase } from "@nv/shared/base/ServiceBase";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import { PromptsClient } from "@nv/shared/prompts/PromptsClient";
import { SvcClient } from "@nv/shared/s2s/SvcClient";
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

export type AppBaseCtor = {
  service: string;
  version: number;
  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;
  checkDb: boolean;
};

export abstract class AppBase extends ServiceBase {
  protected readonly app: Express;
  private _booted = false;

  protected readonly version: number;
  private readonly envName: string;

  private _envDto: EnvServiceDto;
  private readonly envReloader: () => Promise<EnvServiceDto>;

  protected readonly checkDb: boolean;

  protected readonly svcClient: SvcClient;
  protected readonly promptsClient: PromptsClient;

  constructor(opts: AppBaseCtor) {
    super({ service: opts.service });

    this.version = opts.version;
    this._envDto = opts.envDto;
    this.envReloader = opts.envReloader;
    this.checkDb = opts.checkDb;

    // Single source of truth: logical env name comes from EnvServiceDto.
    this.envName = this._envDto.getEnvName();

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

  /** PromptsClient accessor for advanced usage. */
  public getPromptsClient(): PromptsClient {
    return this.promptsClient;
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

  /** Logical environment accessor for callers needing env-aware behavior. */
  public getEnvName(): string {
    return this.envName;
  }

  /** DTO Registry accessor – concrete services MUST implement. */
  public abstract getDtoRegistry(): IDtoRegistry;

  /**
   * Optional svcconfig resolver hook (slug@version → _id).
   * Derived classes may override to enable routePolicyGate.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected getSvcconfigResolver():
    | import("@nv/shared/middleware/policy/routePolicyGate").ISvcconfigResolver
    | null {
    return null;
  }

  /**
   * Default versioned base like `/api/<slug>/v<major>`.
   * Kept for backward compatibility with existing app.ts implementations.
   */
  protected healthBasePath(): string | null {
    return computeHealthBasePath(this.service, this.version);
  }

  /**
   * Async lifecycle entry – MUST be awaited before using `instance`.
   */
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
        envName: this.envName,
        log: this.log,
        readyCheck: this.readyCheck(),
      });
      mountEnvReloadRoute({
        app: this.app,
        base,
        log: this.log,
        envName: this.envName,
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
      envName: this.envName,
    });

    this.mountSecurity();

    mountParserLayer({ app: this.app });

    this.mountRoutes();

    mountPostRoutingLayer({
      app: this.app,
      service: this.service,
      envName: this.envName,
      log: this.log,
    });

    this._booted = true;
    this.log.info({ service: this.service, env: this.envName }, "app booted");
  }

  // ─────────────── Hooks (override sparingly) ───────────────

  /** Boot hook – delegates DB ensure to shared helper. */
  protected async onBoot(): Promise<void> {
    const ctx: DbBootContext = {
      service: this.service,
      component: this.constructor.name,
      envName: this.envName,
      checkDb: this.checkDb,
      envDto: this._envDto,
      log: this.log,
      registry: this.getDtoRegistry(),
    };
    await performDbBoot(ctx);
  }

  /** Optional readiness function for health (override per service). */
  protected readyCheck(): (() => boolean | Promise<boolean>) | undefined {
    return undefined;
  }

  /** Security layer (verifyS2S, CORS, rate limits, etc.). Default: no-op. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected mountSecurity(): void {}

  /** Service routes (one-liners) or proxy – MUST be implemented by concrete app. */
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
