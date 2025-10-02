// backend/services/auth/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: ADR-0004 (Auth Service Skeleton — no minting)
 *
 * Purpose:
 * - Build and configure the Auth app.
 * - Expose ONLY unversioned health: /api/auth/health/{live,ready}
 * - All non-health APIs must live under /api/auth/v1/...
 */

import type { Express } from "express";
import express = require("express");
import { mountServiceHealth } from "@nv/shared/health/mount";
import { authRouter } from "./routes/auth";

export class AuthApp {
  private readonly app: Express;

  constructor() {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.disable("x-powered-by");
    this.app.use(express.json());

    // Health (unversioned by design)
    mountServiceHealth(this.app, { service: "auth", base: "/api/auth/health" });

    // Future: versioned APIs belong under /api/auth/v1/...
    this.app.use("/auth", authRouter());
  }

  public get instance(): Express {
    return this.app;
  }
}
