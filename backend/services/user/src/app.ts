// backend/services/user/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope & Routes)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *   - ADR-0019 (Class Routers via RouterBase)
 *
 * Purpose:
 * - User service on AppBase.
 * - **Versioned** health at /api/<SVC_NAME>/v1/health/{live,ready}.
 * - Versioned APIs mounted under /api/<SVC_NAME>/v1.
 */
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { UsersCrudRouter } from "./routes/users.crud.routes";
import { UserS2SRouter } from "./routes/s2s.auth.routes";

const SERVICE = "user";

export class UserApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  protected configure(): void {
    const baseV1 = `/api/${this.service}/v1`;

    // 0) Body parser BEFORE routers (prevents hangs on JSON endpoints)
    this.app.use(express.json({ limit: "1mb" }));

    // 1) Versioned health
    this.mountVersionedHealth(baseV1);

    // 2) Response error logger (one line on failure)
    this.app.use(responseErrorLogger(this.service));

    // 3) Versioned APIs
    this.app.use(baseV1, new UserS2SRouter().router()); // S2S endpoints
    this.app.use(baseV1, new UsersCrudRouter().router()); // CRUD (no create here)

    // 4) Final JSON error handler (jq-safe)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        // eslint-disable-next-line no-console
        console.error("[user:error]", err);
        res
          .status(500)
          .json({ type: "about:blank", title: "Internal Server Error" });
      }
    );
  }
}
