// backend/services/user/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/0004-auth-service-skeleton.md (pattern reference)
 *   - docs/adr/00xx-user-service-skeleton.md (TBD: this service)
 *
 * Purpose:
 * - Build and configure the User app.
 * - Expose ONLY unversioned health: /api/user/health/{live,ready}
 * - All non-health APIs must live under /api/user/v1/...
 */

import type { Express } from "express";
import express = require("express");
import { mountServiceHealth } from "@nv/shared/health/mount";

export class UserApp {
  private readonly app: Express;

  constructor() {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    this.app.disable("x-powered-by");
    this.app.use(express.json());

    // Health (unversioned by design) — NOTE: user, not auth
    mountServiceHealth(this.app, { service: "user", base: "/api/user/health" });

    // Future: versioned APIs belong under /api/user/v1/...
    // this.app.use("/api/user/v1/...", userRouter());
  }

  public get instance(): Express {
    return this.app;
  }
}
