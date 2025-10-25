// backend/services/shared/src/base/AppBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0013 (Versioned Health Envelope; versioned health routes)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0030 (ContractBase & idempotent contract identification)
 *   - ADR-0032 (RoutePolicyGate — version-agnostic enforcement; health bypass)
 *
 * Purpose:
 * - Canonical Express composition for all services.
 * - Centralizes middleware ordering via overridable hooks:
 *   onBoot → health → preRouting → routePolicy → security → parsers → routes → postRouting
 *
 * Invariants:
 * - Health routes mount FIRST — before routePolicyGate or verifyS2S.
 * - Routes MUST NOT mount until onBoot() completes.
 * - Environment invariant: Dev == Prod behavior (URLs/ports aside).
 */

import type { Express, Router, Request, Response, NextFunction } from "express";
import express = require("express");
import { ServiceBase } from "./ServiceBase";
import { mountServiceHealth } from "../health/mount";
import { responseErrorLogger } from "../middleware/response.error.logger";
import {
  routePolicyGate,
  type ISvcconfigResolver,
} from "../middleware/policy/routePolicyGate";

export abstract class AppBase extends ServiceBase {
  protected readonly app: Express;
  private _booted = false;

  constructor(opts?: { service?: string; context?: Record<string, unknown> }) {
    super(opts);
    this.app = express();
    this.initApp();
  }

  /** Disable noisy headers; keep this minimal. */
  protected initApp(): void {
    this.app.disable("x-powered-by");
  }

  /**
   * Public async lifecycle entry.
   * MUST be awaited by service entrypoints before listen().
   */
  public async boot(): Promise<void> {
    if (this._booted) return;

    await this.onBoot();

    // 1️⃣ Health — always first (never gated)
    const healthBase = this.healthBasePath();
    if (healthBase) {
      this.mountVersionedHealth(healthBase, { readyCheck: this.readyCheck() });
    }

    // 2️⃣ Pre-routing (edge logs, response error logger, etc.)
    this.mountPreRouting();

    // 3️⃣ RoutePolicyGate (shared, skips health paths)
    this.mountRoutePolicyGate();

    // 4️⃣ Security (verifyS2S, rate limits, etc.)
    this.mountSecurity();

    // 5️⃣ Parsers (workers usually want JSON; gateway may override)
    this.mountParsers();

    // 6️⃣ Routes (service-specific routes or proxy)
    this.mountRoutes();

    // 7️⃣ Post-routing (problem handler, sinks, last-ditch error JSON)
    this.mountPostRouting();

    this._booted = true;
    this.log.info({ service: this.service }, "app booted");
  }

  // ───────────────────────────── Hooks (override as needed) ─────────────────────────────

  /** One-time, awaitable boot (e.g., start WAL, warm mirrors). Default: no-op. */
  protected async onBoot(): Promise<void> {}

  /**
   * Default versioned health base path like `/api/<slug>/v1`.
   * Override if the service uses a nonstandard prefix or multiple versions.
   */
  protected healthBasePath(): string | null {
    const slug = this.service?.toLowerCase();
    if (!slug) return null;
    return `/api/${slug}/v1`;
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
    if (!resolver) {
      this.log.debug("routePolicyGate skipped (no resolver provided)");
      return;
    }

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
  protected mountSecurity(): void {}

  /** Body parsers. Default: JSON for workers. Gateway may override. */
  protected mountParsers(): void {
    this.app.use(express.json());
  }

  /** Service routes (one-liners) or proxy. Must be overridden. */
  protected abstract mountRoutes(): void;

  /** Post-routing error funnel and final JSON handler. Safe for jq/CLI. */
  protected mountPostRouting(): void {
    this.app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res
          .status(500)
          .json({ type: "about:blank", title: "Internal Server Error" });
      }
    );
  }

  // ───────────────────────────── Utilities ─────────────────────────────

  protected mountVersionedHealth(
    base: string,
    opts?: { readyCheck?: () => Promise<boolean> | boolean }
  ): void {
    const r: Router = express.Router();
    mountServiceHealth(r as any, {
      service: this.service,
      readyCheck: opts?.readyCheck,
    });
    this.app.use(base, r);
    this.log.info(
      { base, routes: ["GET /health/live", "GET /health/ready"] },
      "health mounted"
    );
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
