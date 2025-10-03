// backend/services/user/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Build and configure the User app.
 * - Expose ONLY unversioned health: /api/<SVC_NAME>/health/{live,ready}
 * - Mount versioned APIs under /api/<SVC_NAME>/v1
 *
 * Notes:
 * - SVC_NAME must come from env (no hard-coding “user”).
 * - S2S-only endpoints (create/signon/changepassword) are mounted via userAuthRouter().
 * - CRUD routes (read/update/delete) are mounted via usersCrudRouter(); CREATE is excluded here.
 */

import type { Express } from "express";
import express = require("express");
import { mountServiceHealth } from "@nv/shared/health/mount";
import { userAuthRouter } from "./routes/s2s.auth.routes";
import { usersCrudRouter } from "./routes/users.crud.routes";

function getSvcName(): string {
  const n = process.env.SVC_NAME?.trim();
  if (!n) throw new Error("SVC_NAME is required but not set");
  return n;
}

export class UserApp {
  private readonly app: Express;

  constructor() {
    this.app = express();
    this.configure();
  }

  private configure(): void {
    const svc = getSvcName();

    this.app.disable("x-powered-by");
    this.app.use(express.json());

    // Health (unversioned) — /api/<SVC_NAME>/health/{live,ready}
    mountServiceHealth(this.app, { service: svc, base: `/api/${svc}/health` });

    // Versioned APIs — mounted under /api/<SVC_NAME>/v1
    // S2S-only endpoints from Auth (PUT /users, POST /signon, POST /changepassword)
    this.app.use(`/api/${svc}/v1`, userAuthRouter());

    // CRUD endpoints (GET/PATCH/DELETE /users/:id) — no create here
    this.app.use(`/api/${svc}/v1`, usersCrudRouter());
  }

  public get instance(): Express {
    return this.app;
  }
}
