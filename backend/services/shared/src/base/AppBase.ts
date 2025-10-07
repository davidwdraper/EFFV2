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
 * - Base class for service "App" layers (Express composition).
 * - Centralizes standard Express setup and provides helpers to mount
 *   versioned health endpoints via the shared health helper.
 *
 * Notes:
 * - Extend this in each service’s App (e.g., GatewayApp, SvcFacilitatorApp).
 */

import type { Express, Router } from "express";
import express = require("express");
import { ServiceBase } from "./ServiceBase";
import { mountServiceHealth } from "../health/mount";

export abstract class AppBase extends ServiceBase {
  protected readonly app: Express;

  constructor(opts?: { service?: string; context?: Record<string, unknown> }) {
    super(opts);
    this.app = express();
    this.initApp();
    this.configure(); // subclass hook
  }

  /**
   * Standard baseline for all apps.
   * - No x-powered-by
   * - JSON parser (can be overridden/extended in configure())
   */
  protected initApp(): void {
    this.app.disable("x-powered-by");
    this.app.use(express.json());
  }

  /**
   * Subclasses override to add routes/middleware.
   * Keep this small; heavy lifting should live in routers/controllers.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected configure(): void {}

  /**
   * Mount versioned health routes at a base like:
   *   base = `/api/<slug>/v1`
   * Resulting routes:
   *   GET <base>/health/live
   *   GET <base>/health/ready
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
