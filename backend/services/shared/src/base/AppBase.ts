// backend/services/shared/src/base/AppBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope; versioned health routes)
 *   - ADR-0032 (RoutePolicyGate — version-agnostic enforcement; health bypass)
 *   - ADR-0039 (env-service centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *
 * Purpose (generic):
 * - Canonical Express composition for ALL services.
 * - Centralizes lifecycle & middleware order:
 *   onBoot → health → preRouting → routePolicy → security → parsers → routes → postRouting
 * - Provides a standard, versioned /env/reload endpoint that atomically refreshes the service env DTO.
 *
 * Invariants:
 * - Health mounts FIRST (never gated).
 * - /env/reload mounts under versioned base and is intended to be policy-gated (UserType >= 5) by RoutePolicy.
 * - AppBase owns the env DTO reference; services read via getters or pass it to their own layers.
 */

import type { Express, Router, Request, Response, NextFunction } from "express";
import express = require("express");
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import {
  routePolicyGate,
  type ISvcconfigResolver,
} from "@nv/shared/middleware/policy/routePolicyGate";
import { ServiceBase } from "@nv/shared/base/ServiceBase";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";

export type AppBaseCtor = {
  service: string;
  version: number;
  envDto: EnvServiceDto;
  /**
   * Called by the /env/reload endpoint to fetch & validate a fresh EnvServiceDto.
   * Must throw on failure; AppBase will translate to 500 JSON.
   */
  envReloader: () => Promise<EnvServiceDto>;
};

export abstract class AppBase extends ServiceBase {
  protected readonly app: Express;
  private _booted = false;

  protected readonly version: number;
  private _envDto: EnvServiceDto;
  private readonly envReloader: () => Promise<EnvServiceDto>;

  constructor(opts: AppBaseCtor) {
    super({ service: opts.service });
    this.version = opts.version;
    this._envDto = opts.envDto;
    this.envReloader = opts.envReloader;

    this.app = express();
    this.initApp();
  }

  /** Disable noisy headers; keep this minimal. */
  protected initApp(): void {
    this.app.disable("x-powered-by");
  }

  /** Current environment DTO (protected for subclasses). */
  protected get envDto(): EnvServiceDto {
    return this._envDto;
  }

  /** Public accessors so controllers/handlers can retrieve the DTO instance. */
  public get svcEnv(): EnvServiceDto {
    return this._envDto;
  }

  /**
   * ADR-0049: Abstract accessor for the DTO Registry so handlers/controllers can
   * depend on the base type instead of concrete app classes.
   * Concrete services MUST override and return their registry instance.
   */
  public abstract getDtoRegistry(): IDtoRegistry;

  /**
   * Public async lifecycle entry.
   * MUST be awaited by service factories before listen().
   */
  public async boot(): Promise<void> {
    if (this._booted) return;

    await this.onBoot();

    // 1) Health — always first (never gated)
    const base = this.healthBasePath();
    if (base) {
      this.mountVersionedHealth(base, { readyCheck: this.readyCheck() });
      // Standardized env-reload endpoint (intended to be policy-gated by routePolicy)
      this.mountEnvReload(base);
    }

    // 2) Pre-routing (edge logs, response error logger, etc.)
    this.mountPreRouting();

    // 3) RoutePolicyGate (shared, skips health paths)
    this.mountRoutePolicyGate();

    // 4) Security (verifyS2S, rate limits, etc.)
    this.mountSecurity();

    // 5) Parsers
    this.mountParsers();

    // 6) Routes (service-specific one-liners)
    this.mountRoutes();

    // 7) Post-routing (problem handler / last-ditch JSON)
    this.mountPostRouting();

    this._booted = true;
    this.log.info({ service: this.service }, "app booted");
  }

  // ─────────────── Hooks (override sparingly) ───────────────

  /** One-time, awaitable boot (e.g., warm caches). Default: no-op. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected async onBoot(): Promise<void> {}

  /** Default versioned base like `/api/<slug>/v<major>` */
  protected healthBasePath(): string | null {
    const slug = this.service?.toLowerCase();
    if (!slug) return null;
    return `/api/${slug}/v${this.version}`;
  }

  /** Optional readiness function for health. */
  protected readyCheck(): (() => boolean | Promise<boolean>) | undefined {
    return undefined;
  }

  /** Pre-routing middleware (edge logging, response error logger, etc.). */
  protected mountPreRouting(): void {
    this.app.use(responseErrorLogger(this.service));
  }

  /**
   * Route-policy gate (shared, skips health paths).
   * Derived classes may override getSvcconfigResolver() to enable.
   */
  protected mountRoutePolicyGate(): void {
    const resolver = this.getSvcconfigResolver();
    if (!resolver) return;

    const facilitatorBaseUrl = process.env.SVCFACILITATOR_BASE_URL;
    if (!facilitatorBaseUrl) {
      this.log.warn(
        "routePolicyGate skipped — SVCFACILITATOR_BASE_URL missing"
      );
      return;
    }

    this.app.use(
      routePolicyGate({
        logger: this.log,
        serviceName: this.service,
        ttlMs: Number(process.env.ROUTE_POLICY_TTL_MS ?? 5000),
        facilitatorBaseUrl,
        resolver,
      })
    );
  }

  /** Optional svcconfig resolver hook (slug@version → _id). Override if needed. */
  protected getSvcconfigResolver(): ISvcconfigResolver | null {
    return null;
  }

  /** Security layer (verifyS2S, CORS, etc.). Default: no-op. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected mountSecurity(): void {}

  /** Body parsers. Default: JSON for workers. Gateway may override. */
  protected mountParsers(): void {
    this.app.use(express.json());
  }

  /** Service routes (one-liners) or proxy. Must be overridden. */
  protected abstract mountRoutes(): void;

  /** Post-routing error funnel and final JSON handler. */
  protected mountPostRouting(): void {
    this.app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        this.log.error(
          {
            error:
              err instanceof Error
                ? { message: err.message, stack: err.stack }
                : err,
          },
          "unhandled error in request pipeline"
        );
        res
          .status(500)
          .json({ type: "about:blank", title: "Internal Server Error" });
      }
    );
  }

  // ─────────────── Built-ins (generic) ───────────────

  /**
   * Explicit versioned health path to avoid double-prefix ambiguity.
   * Final path: `${base}/health` (e.g., /api/xxx/v1/health)
   */
  protected mountVersionedHealth(
    base: string,
    opts?: { readyCheck?: () => Promise<boolean> | boolean }
  ): void {
    const path = `${base}/health`;
    this.app.get(path, async (_req: Request, res: Response) => {
      try {
        const ready = opts?.readyCheck ? await opts.readyCheck() : true;
        res.status(200).json({
          ok: true,
          service: this.service,
          version: this.version,
          ready,
          ts: new Date().toISOString(),
        });
      } catch {
        // If the readyCheck throws, still return a syntactically valid health, but ready=false
        res.status(200).json({
          ok: true,
          service: this.service,
          version: this.version,
          ready: false,
          ts: new Date().toISOString(),
        });
      }
    });
    this.log.info({ path }, "health mounted");
  }

  /**
   * Standardized environment reload endpoint.
   * Path: `${base}/env/reload` → POST
   * Contract: returns { ok, reloadedAt, env, slug, version, level }
   * Policy: expected to be allowed ONLY for UserType >= 5 via routePolicy.
   */
  protected mountEnvReload(base: string): void {
    const path = `${base}/env/reload`;
    this.app.post(path, async (_req: Request, res: Response) => {
      const fromEnv = this._envDto.env;
      const fromSlug = this._envDto.slug;
      const fromVersion = this._envDto.version;
      const fromLevel = this._envDto.level;

      try {
        const fresh = await this.envReloader();
        this._envDto = fresh; // atomic swap

        return res.status(200).json({
          ok: true,
          reloadedAt: new Date().toISOString(),
          from: {
            env: fromEnv,
            slug: fromSlug,
            version: fromVersion,
            level: fromLevel,
          },
          to: {
            env: fresh.env,
            slug: fresh.slug,
            version: fresh.version,
            level: fresh.level,
          },
        });
      } catch (err) {
        return res.status(500).json({
          ok: false,
          type: "about:blank",
          title: "env_reload_failed",
          detail:
            (err as Error)?.message ??
            "Failed to reload environment. Ops: verify env-service configuration document and DB connectivity.",
        });
      }
    });
    this.log.info({ path }, "env reload mounted");
  }

  /** Expose the Express instance to the entrypoint (after boot). */
  public get instance(): Express {
    if (!this._booted) {
      throw new Error(
        `[${this.service}] App not booted. Call and await app.boot() before using instance.`
      );
    }
    return this.app;
  }
}
