// backend/services/shared/src/base/AppBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0013 (Versioned Health Envelope; versioned health routes)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *
 * Purpose:
 * - Canonical Express composition for all services.
 * - Centralizes middleware ordering via overridable hooks:
 *   onBoot → health → preRouting → security → parsers → routes → postRouting
 *
 * Notes:
 * - Services should be tiny subclasses overriding only what they must.
 * - No environment-specific branches. Dev == Prod behavior (URLs/ports aside).
 */

import type { Express, Router, Request, Response, NextFunction } from "express";
import express = require("express");
import { ServiceBase } from "./ServiceBase";
import { mountServiceHealth } from "../health/mount";
import { responseErrorLogger } from "../middleware/response.error.logger";

export abstract class AppBase extends ServiceBase {
  protected readonly app: Express;

  constructor(opts?: { service?: string; context?: Record<string, unknown> }) {
    super(opts);
    this.app = express();
    this.initApp();
    this.configureBase(); // runs the standardized mounting sequence
  }

  /** Disable noisy headers; keep this minimal. */
  protected initApp(): void {
    this.app.disable("x-powered-by");
  }

  /** Fixed sequence — do not override; customize via the protected hooks below. */
  private configureBase(): void {
    // 0) Synchronous boot hook (warm caches, set fields, etc.)
    this.onBoot();

    // 1) Versioned health (mounted first)
    const healthBase = this.healthBasePath();
    if (healthBase) {
      this.mountVersionedHealth(healthBase, { readyCheck: this.readyCheck() });
    }

    // 2) Pre-routing (edge logs, response error logger, etc.)
    this.mountPreRouting();

    // 3) Security (verifyS2S, rate limits, etc.)
    this.mountSecurity();

    // 4) Parsers (workers usually want JSON; gateway may override to none)
    this.mountParsers();

    // 5) Routes (service-specific routes or proxy)
    this.mountRoutes();

    // 6) Post-routing (problem handler, sinks, last-ditch error JSON)
    this.mountPostRouting();
  }

  // ───────────────────────────── Hooks (override as needed) ─────────────────────────────

  /** One-time, synchronous boot (e.g., kick off warm loads). */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected onBoot(): void {}

  /** Return the versioned health base path like "/api/<slug>/v1"; return null to skip. */
  protected healthBasePath(): string | null {
    return null;
  }

  /** Optional readiness function for health. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected readyCheck(): (() => boolean | Promise<boolean>) | undefined {
    return undefined;
  }

  /** Pre-routing middleware (edge logging, response error logger, etc.). */
  protected mountPreRouting(): void {
    // Shared one-line error logger by default; services may add more (e.g., edge logs).
    this.app.use(responseErrorLogger(this.service));
  }

  /** Security layer (verifyS2S, CORS, etc.). Default: no-op. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected mountSecurity(): void {}

  /** Body parsers. Default: JSON for workers. Gateway should override to do nothing. */
  protected mountParsers(): void {
    this.app.use(express.json());
  }

  /** Service routes (one-liners) or proxy. Must be overridden. */
  protected abstract mountRoutes(): void;

  /** Post-routing error funnel and final JSON handler. Safe for jq/CLI. */
  protected mountPostRouting(): void {
    // Final JSON error handler (keeps responses structured)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        // Do not leak error details; upstream should already be logged.
        res
          .status(500)
          .json({ type: "about:blank", title: "Internal Server Error" });
      }
    );
  }

  // ───────────────────────────── Utilities ─────────────────────────────

  /**
   * Mount versioned health routes at a base like:
   *   base = `/api/<slug>/v1`
   * Resulting routes:
   *   GET <base>/health/live
   *   GET <base>/health/ready`
   */
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

  /** Expose the Express instance to the entrypoint. */
  public get instance(): Express {
    return this.app;
  }
}
