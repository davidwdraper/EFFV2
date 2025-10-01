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
import { mountServiceHealth } from "@nv/shared/health/mount"; // canonical /api/<service>/health/*
import { mountHealth } from "@nv/shared/health/Health"; // legacy /health/*
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

    // Canonical health: /api/auth/health/{live,ready}
    mountServiceHealth(this.app, { service: "auth" });

    // Back-compat shim for any old callers/tests hitting /health/*
    mountHealth(this.app, { service: "auth" });

    // Auth endpoints (mock returns for now; minting later)
    this.app.use("/auth", authRouter());
  }

  public get instance(): Express {
    return this.app;
  }
}
