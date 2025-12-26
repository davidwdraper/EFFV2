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
 *
 * Purpose:
 * - Orchestrator for Express composition across ALL services.
 * - Holds boot-time decisions so downstream wiring never re-reads env.
 *
 * Invariants:
 * - No implicit S2S mocking.
 * - Deterministic S2S transport may ONLY be injected explicitly (tests).
 * - SvcRuntime is MANDATORY and is the canonical runtime owner of:
 *     • problem
 *     • validated vars
 *     • capability surfaces (db/s2s/audit/etc.)
 *
 * Commit 2 (SvcRuntime hard requirement):
 * - envLabel is sourced ONLY from rt (no envDto fallback / optional ctor value).
 * - If envDto exists, it must agree with rt env (sanity check).
 *
 * Commit 3 (Proxy services):
 * - DtoRegistry is OPTIONAL at AppBase level.
 * - Only DB-backed services (checkDb=true) may require registry at boot.
 * - Proxy/edge services (gateway) must compile without implementing getDtoRegistry().
 *
 * Commit 4 (Infra boot check hook split):
 * - `isInfraService()` is platform classification (gateway may be "infra" by role).
 * - `shouldSkipInfraBootHealthCheck()` is recursion avoidance only.
 * - Default behavior remains identical: skip boot preflight when isInfraService()=true.
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
import type { SvcRuntime } from "../../runtime/SvcRuntime";
import { SvcEnvClient } from "../../env/svcenvClient";
import { InfraHealthCheck } from "../../bootstrap/InfraHealthCheck";

export type AppBaseCtor = {
  service: string;
  version: number;

  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;
  checkDb: boolean;
  edgeMode?: EdgeMode;

  /**
   * SvcRuntime is MANDATORY (ADR-0080).
   * If it is not wired, the app must not start.
   */
  rt: SvcRuntime;

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
  private _envDto: EnvServiceDto;
  private readonly envReloader: () => Promise<EnvServiceDto>;
  protected readonly checkDb: boolean;

  protected readonly svcClient: SvcClient;
  protected readonly promptsClient: PromptsClient;

  private readonly edgeMode: EdgeMode;
  private readonly s2sMocksEnabled: boolean;
  private readonly hasInjectedSvcClientTransport: boolean;

  private readonly rt: SvcRuntime;

  constructor(opts: AppBaseCtor) {
    super({ service: opts.service });

    this.version = opts.version;
    this._envDto = opts.envDto;
    this.envReloader = opts.envReloader;
    this.checkDb = opts.checkDb;

    this.edgeMode = opts.edgeMode ?? EdgeMode.Prod;
    this.s2sMocksEnabled = opts.s2sMocksEnabled ?? false;
    this.hasInjectedSvcClientTransport = !!opts.svcClientTransport;

    if (!opts.rt) {
      throw new Error(
        `SSB_MISSING_ON_APPBASE: SvcRuntime is required for service="${opts.service}" v${opts.version}. ` +
          "Ops/Dev: construct SvcRuntime during boot (after envDto is available) and pass it to AppBase({ rt })."
      );
    }
    this.rt = opts.rt;

    // Commit 2: envLabel is now owned by rt. envDto must agree.
    // This prevents “sandbox exists but isn’t authoritative” drift.
    try {
      const dtoEnv = (this._envDto.getEnvLabel() ?? "").trim();
      const rtEnv = (this.rt.getEnv() ?? "").trim();
      if (!rtEnv) {
        throw new Error(
          `SSB_ENV_EMPTY: rt.getEnv() returned empty for service="${opts.service}" v${opts.version}.`
        );
      }
      if (dtoEnv && dtoEnv !== rtEnv) {
        throw new Error(
          `SSB_ENV_MISMATCH: envDto env="${dtoEnv}" does not match rt env="${rtEnv}" for service="${opts.service}" v${opts.version}. ` +
            "Dev: build rt using the same env label resolved by envBootstrap/env-service."
        );
      }
    } catch (e: any) {
      throw new Error(
        `SSB_ENV_VALIDATION_FAILED: ${(e as Error)?.message ?? String(e)}`
      );
    }

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
   * Infra classification hook (ADR-0082).
   *
   * Meaning:
   * - Platform/service-role classification only.
   * - This MUST NOT be overloaded as a recursion-avoidance toggle.
   *
   * Default:
   * - Domain services return false.
   *
   * Infra/platform services:
   * - Override to true (env-service, svcconfig, gateway, log-service, prompts, etc.).
   */
  public isInfraService(): boolean {
    return false;
  }

  /**
   * ADR-0082 recursion avoidance hook.
   *
   * Purpose:
   * - Prevent infra services from running the infra boot health preflight
   *   in cases where it would recurse or deadlock (env-service, svcconfig, etc.).
   *
   * Default behavior:
   * - Preserve legacy behavior by skipping when isInfraService() is true.
   *
   * Important:
   * - Gateway may be "infra" by platform role but still need preflight checks.
   *   In that case, gateway should override this to return false.
   */
  public shouldSkipInfraBootHealthCheck(): boolean {
    return this.isInfraService();
  }

  /**
   * Sandbox accessor (ADR-0080).
   *
   * Invariant:
   * - Sandbox MUST exist or app construction fails.
   */
  public getSandbox(): SvcRuntime {
    return this.rt;
  }

  /**
   * EnvServiceDto accessor (preferred for controllers/handlers).
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

  /**
   * Commit 2: env label is sourced ONLY from SvcRuntime.
   */
  public getEnvLabel(): string {
    const env = (this.rt.getEnv() ?? "").trim();
    if (!env) {
      throw new Error(
        `SSB_ENV_EMPTY: rt.getEnv() returned empty for service="${this.service}" v${this.version}.`
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

  /**
   * DTO Registry accessor.
   *
   * Commit 3:
   * - Registry is OPTIONAL at the AppBase level so proxy/edge services can exist.
   * - DTO/DB-backed services MUST override this method.
   *
   * Fail-fast:
   * - If any code calls this on a non-DTO service (e.g., gateway), it is a bug.
   */
  public getDtoRegistry(): IDtoRegistry {
    throw new Error(
      `DTO_REGISTRY_NOT_AVAILABLE: service="${this.service}" v${this.version} does not provide a DtoRegistry. ` +
        "Dev: only DTO/DB-backed services may call getDtoRegistry(). " +
        "Ops: gateway/proxy services must not load registry-dependent controllers/handlers."
    );
  }

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
    // No fallbacks. If the feature is enabled (resolver exists), config must exist.
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
    // Recursion/deadlock avoidance hook (ADR-0082).
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

    // Domain services (and any platform service that opts in): enforce infra availability before proceeding with boot.
    const envClient = new SvcEnvClient({ svcClient: this.svcClient });

    const checker = new InfraHealthCheck({
      svcClient: this.svcClient,
      envClient,
      log: this.log,
      currentServiceSlug: this.service,
      envLabel: this.getEnvLabel(),
    });

    await checker.run();
  }

  public async boot(): Promise<void> {
    if (this._booted) return;

    // ADR-0082: Services that opt in must hard-fail if infra deps are not healthy.
    // This happens before DB boot and before routes are mounted.
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
        resolver,
        facilitatorBaseUrl,
        ttlMs,
      });
    } else {
      mountRoutePolicyGateLayer({
        app: this.app,
        service: this.service,
        log: this.log,
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
        envLabel: this.getEnvLabel(),
        edgeMode: this.edgeMode,
        s2sMocksEnabled: this.s2sMocksEnabled,
        hasInjectedSvcClientTransport: this.hasInjectedSvcClientTransport,
        hasSandbox: true,
      },
      "app booted"
    );
  }

  protected async onBoot(): Promise<void> {
    // Proxy/edge services must not require registry at boot.
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
