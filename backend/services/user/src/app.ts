// backend/services/user/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope & Routes)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *
 * Purpose:
 * - User service on AppBase.
 * - **Versioned** health at /api/<SVC_NAME>/v1/health/{live,ready}.
 * - Versioned APIs mounted under /api/<SVC_NAME>/v1.
 *
 * Note:
 * - We fix SVC_NAME to "user" (mirrors Auth’s pattern) to avoid env-load
 *   timing issues—Bootstrap loads .env after AppBase ctor. If you later want
 *   env-driven names, wire them at the ServiceEntrypoint and pass into AppBase.
 */

import type { Request, Response, NextFunction } from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { userAuthRouter } from "./routes/s2s.auth.routes";
import { usersCrudRouter } from "./routes/users.crud.routes";

const SERVICE = "user";

export class UserApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  protected configure(): void {
    const baseV1 = `/api/${this.service}/v1`;

    // 1) Versioned health (exact match with Auth pattern)
    this.mountVersionedHealth(baseV1);

    // 2) One-line response error logger
    this.app.use(responseErrorLogger(this.service));

    // 3) Versioned APIs
    this.app.use(baseV1, userAuthRouter()); // S2S endpoints
    this.app.use(baseV1, usersCrudRouter()); // CRUD (no create here)

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
