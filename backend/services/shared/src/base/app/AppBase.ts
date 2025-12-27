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
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0082 (Infra Service Health Boot Check)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Orchestrator for Express composition across ALL services.
 * - Holds boot-time decisions so downstream wiring never re-reads env.
 *
 * Invariants:
 * - SvcRuntime is MANDATORY.
 * - Service posture is the single source of truth for boot rails.
 * - Baseline capability surface is wired here (lazy factories).
 * - Handlers must access capabilities through rt only.
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
import type { ISvcconfigResolver } from "@nv/shared/s2s/SvcClient";
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
import type { SvcRuntime } from "../../runtime/SvcRuntime";
import { SvcEnvClient } from "../../env/svcenvClient";
import { InfraHealthCheck } from "../../bootstrap/InfraHealthCheck";
import { type SvcPosture, isDbPosture } from "../../runtime/SvcPosture";

export type AppBaseCtor = {
  service: string;
  version: number;

  posture: SvcPosture;

  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;
  edgeMode?: EdgeMode;

  /**
   * SvcRuntime is MANDATORY (ADR-0080).
   */
  rt: SvcRuntime;

  /**
   * Explicit-only S2S mocking switch (tests only).
   */
  s2sMocksEnabled?: boolean;

  /**
   * Deterministic S2S transport (tests only).
   */
  svcClientTransport?: ISvcClientTransport;
};

export abstract class AppBase extends ServiceBase {
  protected readonly app: Express;
  private _booted = false;

  protected readonly version: number;
  private _envDto: EnvServiceDto;
  private readonly envReloader: () => Promise<EnvServiceDto>;

  protected readonly posture: SvcPosture;
  protected readonly checkDb: boolean;

  private readonly edgeMode: EdgeMode;
  private readonly s2sMocksEnabled: boolean;
  private readonly hasInjectedSvcClientTransport: boolean;
  private readonly svcClientTransport?: ISvcClientTransport;

  private readonly rt: SvcRuntime;

  constructor(opts: AppBaseCtor) {
    super({ service: opts.service });

    this.version = opts.version;
    this._envDto = opts.envDto;
    this.envReloader = opts.envReloader;

    this.posture = opts.posture;
    this.checkDb = isDbPosture(this.posture);

    this.edgeMode = opts.edgeMode ?? EdgeMode.Prod;
    this.s2sMocksEnabled = opts.s2sMocksEnabled ?? false;
    this.hasInjectedSvcClientTransport = !!opts.svcClientTransport;
    this.svcClientTransport = opts.svcClientTransport;

    if (!opts.rt) {
      throw new Error(
        `SVCRUNTIME_MISSING: SvcRuntime is required for service="${opts.service}" v${opts.version}. ` +
          "Ops/Dev: construct SvcRuntime during boot (after envDto is available) and pass it to AppBase({ rt })."
      );
    }
    this.rt = opts.rt;

    // envLabel is owned by rt. envDto must agree.
    try {
      const dtoEnv = (this._envDto.getEnvLabel() ?? "").trim();
      const rtEnv = (this.rt.getEnv() ?? "").trim();
      if (!rtEnv) {
        throw new Error(
          `SVCRUNTIME_ENV_EMPTY: rt.getEnv() returned empty for service="${opts.service}" v${opts.version}.`
        );
      }
      if (dtoEnv && dtoEnv !== rtEnv) {
        throw new Error(
          `SVCRUNTIME_ENV_MISMATCH: envDto env="${dtoEnv}" does not match rt env="${rtEnv}" for service="${opts.service}" v${opts.version}. ` +
            "Dev: build rt using the same env label resolved by envBootstrap/env-service."
        );
      }
    } catch (e: any) {
      throw new Error(
        `SVCRUNTIME_ENV_VALIDATION_FAILED: ${
          (e as Error)?.message ?? String(e)
        }`
      );
    }

    this.app = express();
    this.initApp();

    // Wire baseline runtime capabilities (lazy, explicit).
    this.wireRuntimeCaps();
  }

  protected initApp(): void {
    this.app.disable("x-powered-by");
  }

  /**
   * Capability wiring hook (ADR-0080 / ADR-0084).
   *
   * Default:
   * - Wire the baseline S2S capability into rt under the canonical key
   *   "s2s.svcClient".
   *
   * Override:
   * - Services may opt into additional caps by overriding and calling helpers.
   *
   * Rules:
   * - No fallbacks.
   * - Factories MUST either return a concrete instance or throw.
   */
  protected wireRuntimeCaps(): void {
    // Canonical S2S cap key used by handlers (e.g., "s2s.svcClient").
    const capKey = "s2s.svcClient";

    this.rt.setCapFactory(capKey, (_rt) => {
      return createSvcClientForApp({
        service: this.service,
        version: this.version,
        log: this.log,
        envDto: this._envDto,
        s2sMocksEnabled: this.s2sMocksEnabled,
        transport: this.svcClientTransport,
      });
    });

    // Compile-safe, deterministic breadcrumb: proves which AppBase build is running.
    this.log.info(
      {
        event: "rt_cap_factory_wired",
        capKey,
        service: this.service,
        version: this.version,
      },
      "wired runtime cap factory"
    );
  }

  protected wirePromptsClientCap(): void {
    this.rt.setCapFactory("promptsClient", (rt) => {
      const svcClient = rt.getCap<SvcClient>("s2s.svcClient");
      return createPromptsClientForApp({
        service: this.service,
        log: this.log,
        svcClient,
        getEnvLabel: () => this.getEnvLabel(),
        getRequestId: undefined,
      });
    });
  }

  public isInfraService(): boolean {
    return false;
  }

  public shouldSkipInfraBootHealthCheck(): boolean {
    return this.isInfraService();
  }

  public getRuntime(): SvcRuntime {
    return this.rt;
  }

  public getSvcEnv(): EnvServiceDto {
    return this._envDto;
  }

  public getLogger(): IBoundLogger {
    return this.log;
  }

  public getPromptsClient(): PromptsClient {
    return this.rt.getCap<PromptsClient>("promptsClient");
  }

  public getSvcClient(): SvcClient {
    return this.rt.getCap<SvcClient>("s2s.svcClient");
  }

  public getEnvLabel(): string {
    const env = (this.rt.getEnv() ?? "").trim();
    if (!env) {
      throw new Error(
        `SVCRUNTIME_ENV_EMPTY: rt.getEnv() returned empty for service="${this.service}" v${this.version}.`
      );
    }
    return env;
  }

  public getEdgeMode(): EdgeMode {
    return this.edgeMode;
  }

  public getS2sMocksEnabled(): boolean {
    return this.s2sMocksEnabled;
  }

  public async prompt(
    language: string,
    promptKey: string,
    params?: Record<string, string | number>,
    meta: Record<string, unknown> = {}
  ): Promise<string> {
    return this.getPromptsClient().render(language, promptKey, params, meta);
  }

  public getDtoRegistry(): IDtoRegistry {
    throw new Error(
      `DTO_REGISTRY_NOT_AVAILABLE: service="${this.service}" v${this.version} does not provide a DtoRegistry. ` +
        "Dev: only DB posture services may call getDtoRegistry()."
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected getSvcconfigResolver(): ISvcconfigResolver | null {
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
      envLabel: this.getEnvLabel(),
      lockImmediately: true,
    });

    const st = getProcessEnvGuardState();
    this.log.info(
      { processEnvGuard: st, envLabel: this.getEnvLabel() },
      `[${this.service}] process.env guard enabled`
    );
  }

  private readRoutePolicyGateConfig(): {
    facilitatorBaseUrl: string;
    ttlMs: number;
  } {
    const facilitatorBaseUrl = this._envDto
      .getEnvVar("SVCFACILITATOR_BASE_URL")
      .trim();
    if (!facilitatorBaseUrl) {
      throw new Error(
        `ROUTE_POLICY_FACILITATOR_BASE_URL_MISSING: routePolicyGate enabled for service="${this.service}" but SVCFACILITATOR_BASE_URL is missing/empty. ` +
          "Ops: set SVCFACILITATOR_BASE_URL in env-service for this service."
      );
    }

    const rawTtl = this._envDto.getEnvVar("ROUTE_POLICY_TTL_MS").trim();
    const n = Number(rawTtl);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(
        `ROUTE_POLICY_TTL_INVALID: routePolicyGate enabled for service="${this.service}" but ROUTE_POLICY_TTL_MS is invalid ("${rawTtl}"). ` +
          "Ops: set ROUTE_POLICY_TTL_MS to a positive integer string in env-service for this service."
      );
    }

    return { facilitatorBaseUrl, ttlMs: Math.trunc(n) };
  }

  private async maybeRunInfraBootHealthCheck(): Promise<void> {
    if (this.shouldSkipInfraBootHealthCheck()) {
      this.log.info(
        {
          event: "infra_boot_check_skipped",
          reason: "should_skip_infra_boot_health_check",
          isInfraService: this.isInfraService(),
        },
        "Infra boot health check skipped"
      );
      return;
    }

    const svcClient = this.getSvcClient();
    const envClient = new SvcEnvClient({ svcClient });

    const checker = new InfraHealthCheck({
      svcClient,
      envClient,
      log: this.log,
      currentServiceSlug: this.service,
      envLabel: this.getEnvLabel(),
    });

    await checker.run();
  }

  public async boot(): Promise<void> {
    if (this._booted) return;

    await this.maybeRunInfraBootHealthCheck();
    await this.onBoot();

    const base = this.healthBasePath();
    if (base) {
      mountVersionedHealthRoute({
        app: this.app,
        base,
        service: this.service,
        version: this.version,
        envLabel: this.getEnvLabel(),
        log: this.log,
        readyCheck: this.readyCheck(),
      });

      mountEnvReloadRoute({
        app: this.app,
        base,
        log: this.log,
        envLabel: this.getEnvLabel(),
        getEnvDto: () => this._envDto,
        setEnvDto: (fresh) => {
          this._envDto = fresh;
        },
        envReloader: this.envReloader,
      });
    }

    mountPreRoutingLayer({ app: this.app, service: this.service });

    const resolver = this.getSvcconfigResolver();
    if (resolver) {
      const { facilitatorBaseUrl, ttlMs } = this.readRoutePolicyGateConfig();
      mountRoutePolicyGateLayer({
        app: this.app,
        service: this.service,
        log: this.log,
        envLabel: this.getEnvLabel(),
        resolver,
        facilitatorBaseUrl,
        ttlMs,
      });
    } else {
      mountRoutePolicyGateLayer({
        app: this.app,
        service: this.service,
        log: this.log,
        envLabel: this.getEnvLabel(),
        resolver: null,
      });
    }

    this.mountSecurity();
    mountParserLayer({ app: this.app });
    this.mountRoutes();

    mountPostRoutingLayer({
      app: this.app,
      serviceSlug: this.service,
      serviceVersion: this.version,
      envLabel: this.getEnvLabel(),
      log: this.log,
    });

    this.maybeEnableProcessEnvGuard();

    this._booted = true;
    this.log.info(
      {
        service: this.service,
        version: this.version,
        posture: this.posture,
        envLabel: this.getEnvLabel(),
        edgeMode: this.edgeMode,
        s2sMocksEnabled: this.s2sMocksEnabled,
        hasInjectedSvcClientTransport: this.hasInjectedSvcClientTransport,
        hasRuntime: true,
      },
      "app booted"
    );
  }

  protected async onBoot(): Promise<void> {
    if (!this.checkDb) return;

    const ctx: DbBootContext = {
      service: this.service,
      component: this.constructor.name,
      envLabel: this.getEnvLabel(),
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
