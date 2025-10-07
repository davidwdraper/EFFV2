// backend/services/auth/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0004 (Auth Service Skeleton — no minting)
 *   - ADR-0013 (Versioned Health Envelope; versioned health routes)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint vs ServiceBase → AppBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *
 * Purpose:
 * - OO refactor: AuthApp extends AppBase → ServiceBase.
 * - Mount **versioned** health at:
 *     /api/auth/v1/health/{live,ready}
 * - Mount versioned APIs under /api/auth (router provides /v1/...).
 */

import type { Request, Response, NextFunction } from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { authRouter } from "./routes/auth.route";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";

const SERVICE = "auth";

export class AuthApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  protected configure(): void {
    // 1) Versioned health per ADR-0013
    this.mountVersionedHealth("/api/auth/v1");

    // 2) Versioned APIs under /api/auth (router owns /v1/... paths)
    this.app.use("/api/auth", authRouter());

    // 3) Response/error logging (jq-safe), after routes so failures are captured
    this.app.use(responseErrorLogger(SERVICE));

    // 4) Final JSON error handler as a last resort
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        // Loud until global problem.ts middleware is wired everywhere.
        // eslint-disable-next-line no-console
        console.error("[auth:error]", err);
        res
          .status(500)
          .json({ type: "about:blank", title: "Internal Server Error" });
      }
    );
  }
}
