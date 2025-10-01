// backend/services/auth/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: ADR-0004 (Auth Service Skeleton — no minting)
 *
 * Purpose:
 * - Build and configure the Express app (routes, middleware).
 */

import type { Express } from "express";
import express = require("express");
import { mountHealth } from "@nv/shared/src/health/Health";
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

    // Health (shared implementation)
    mountHealth(this.app, { service: "auth" });

    // Auth endpoints (mock returns for now; minting later)
    this.app.use("/auth", authRouter());
  }

  public get instance(): Express {
    return this.app;
  }
}
