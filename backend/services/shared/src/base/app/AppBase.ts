// backend/services/shared/src/base/app/AppBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope)
 *   - ADR-0039 (env-service centralized non-secret env)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *   - ADR-0076 (Process Env Guard — NV_PROCESS_ENV_GUARD runtime guardrail)
 *
 * Purpose:
 * - Orchestrator for Express composition across ALL services.
 * - Holds boot-time decisions so downstream wiring never re-reads env.
 *
 * Invariants:
 * - No implicit S2S mocking.
 * - Deterministic S2S transport may ONLY be injected explicitly (tests).
 */

import type { Express } from "express";
import express = require("express");
import { ServiceBase } from "@nv/shared/base/ServiceBase";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import { PromptsClient } from "@nv/shared/prompts/PromptsClient";
import { SvcClient, type ISvcClientTransport } from "@nv/shared/s2s/SvcClient";
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
import { EdgeMode } from "../../env/edgeModeFactory";
import {
  installProcessEnvGuard,
  isProcessEnvGuardEnabled,
  getProcessEnvGuardState,
} from "./processEnvGuard";

export type AppBaseCtor = {
  service: string;
  version: number;
  envLabel?: string;
  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;
  checkDb: boolean;
  edgeMode?: EdgeMode;

  /**
   * Explicit-only S2S mocking switch (tests only).
   */
  s2sMocksEnabled?: boolean;

  /**
   * Deterministic S2S transport (tests only).
   * When provided, overrides BOTH fetch and blocked transports.
   */
  svcClientTransport?: ISvcClientTransport;
};

export abstract class AppBase extends ServiceBase {
  protected readonly app: Express;
  private _booted = false;

  protected readonly version: number;
  private readonly envLabel: string;
  private _envDto: EnvServiceDto;
  private readonly envReloader: () => Promise<EnvServiceDto>;
  protected readonly checkDb: boolean;

  protected readonly svcClient: SvcClient;
  protected readonly promptsClient: PromptsClient;

  private readonly edgeMode: EdgeMode;
  private readonly s2sMocksEnabled: boolean;
  private readonly hasInjectedSvcClientTransport: boolean;

  constructor(opts: AppBaseCtor) {
    super({ service: opts.service });

    this.version = opts.version;
    this._envDto = opts.envDto;
    this.envReloader = opts.envReloader;
    this.checkDb = opts.checkDb;

    this.envLabel = opts.envLabel ?? this._envDto.getEnvLabel();
    this.edgeMode = opts.edgeMode ?? EdgeMode.Prod;
    this.s2sMocksEnabled = opts.s2sMocksEnabled ?? false;
    this.hasInjectedSvcClientTransport = !!opts.svcClientTransport;

    this.app = express();
    this.initApp();

    this.svcClient = createSvcClientForApp({
      service: this.service,
      version: this.version,
      log: this.log,
      envDto: this._envDto,
      s2sMocksEnabled: this.s2sMocksEnabled,
      transport: opts.svcClientTransport,
    });

    this.promptsClient = createPromptsClientForApp({
      service: this.service,
      log: this.log,
      svcClient: this.svcClient,
      getEnvLabel: () => this.getEnvLabel(),
      getRequestId: undefined,
    });
  }

  protected initApp(): void {
    this.app.disable("x-powered-by");
  }

  /**
   * EnvServiceDto accessor (preferred for controllers/handlers).
   * Note: legacy `app.svcEnv` access is supported by ControllerBase as a compatibility path.
   */
  public getSvcEnv(): EnvServiceDto {
    return this._envDto;
  }

  /** Legacy accessor (kept for compatibility; prefer getSvcEnv()). */
  public get svcEnv(): EnvServiceDto {
    return this._envDto;
  }

  public getLogger(): IBoundLogger {
    return this.log;
  }

  public getPromptsClient(): PromptsClient {
    return this.promptsClient;
  }

  public getSvcClient(): SvcClient {
    return this.svcClient;
  }

  public getEnvLabel(): string {
    return this.envLabel;
  }

  public getEdgeMode(): EdgeMode {
    return this.edgeMode;
  }

  public getS2sMocksEnabled(): boolean {
    return this.s2sMocksEnabled;
  }

  /**
   * Convenience wrapper used by HTML controllers (and any future UX surfaces).
   * This keeps prompt semantics centralized behind PromptsClient.
   */
  public async prompt(
    language: string,
    promptKey: string,
    params?: Record<string, string | number>,
    meta: Record<string, unknown> = {}
  ): Promise<string> {
    return this.promptsClient.render(language, promptKey, params, meta);
  }

  public abstract getDtoRegistry(): IDtoRegistry;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected getSvcconfigResolver(): any | null {
    return null;
  }

  protected healthBasePath(): string | null {
    return computeHealthBasePath(this.service, this.version);
  }

  private maybeEnableProcessEnvGuard(): void {
    let raw: string | null = null;
    try {
      raw = this._envDto.getEnvVar("NV_PROCESS_ENV_GUARD");
    } catch {
      raw = null;
    }

    if (!isProcessEnvGuardEnabled(raw)) return;

    installProcessEnvGuard({
      service: this.service,
      envLabel: this.envLabel,
      lockImmediately: true,
    });

    const st = getProcessEnvGuardState();
    this.log.info(
      { processEnvGuard: st, envLabel: this.envLabel },
      `[${this.service}] process.env guard enabled`
    );
  }

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

    mountPreRoutingLayer({ app: this.app, service: this.service });
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

    this.maybeEnableProcessEnvGuard();

    this._booted = true;
    this.log.info(
      {
        service: this.service,
        envLabel: this.envLabel,
        edgeMode: this.edgeMode,
        s2sMocksEnabled: this.s2sMocksEnabled,
        hasInjectedSvcClientTransport: this.hasInjectedSvcClientTransport,
      },
      "app booted"
    );
  }

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

  protected readyCheck(): (() => boolean | Promise<boolean>) | undefined {
    return undefined;
  }

  protected mountSecurity(): void {}
  protected abstract mountRoutes(): void;

  public get instance(): Express {
    if (!this._booted) {
      throw new Error(
        `[${this.service}] App not booted. Call and await app.boot() before using instance.`
      );
    }
    return this.app;
  }
}
