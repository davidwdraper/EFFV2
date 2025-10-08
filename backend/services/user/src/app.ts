// backend/services/user/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope & Routes)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *   - ADR-0019 (Class Routers via RouterBase)
 *   - adr0021-user-opaque-password-hash
 *
 * Purpose:
 * - User service on AppBase.
 * - **Versioned** health at /api/<SVC_NAME>/v1/health/{live,ready}.
 * - Versioned APIs mounted under /api/<SVC_NAME>/v1.
 */
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { unwrapEnvelope } from "@nv/shared/middleware/unwrapEnvelope";
import { problem } from "@nv/shared/middleware/problem";
import { UsersCrudRouter } from "./routes/users.crud.routes";
import { UserS2SRouter } from "./routes/s2s.auth.routes";

const SERVICE = "user";

export class UserApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  protected configure(): void {
    const baseV1 = `/api/${this.service}/v1`;

    // 1) Versioned health — FIRST
    this.mountVersionedHealth(baseV1);

    // 2) JSON body parser
    this.app.use(express.json({ limit: "1mb" }));

    // 3) Unwrap S2S envelopes to flat DTOs that controllers expect
    this.app.use(unwrapEnvelope());

    // 4) One-line completion/error logger
    this.app.use(responseErrorLogger(this.service));

    // 5) Versioned APIs
    this.app.use(baseV1, new UserS2SRouter().router()); // S2S endpoints
    this.app.use(baseV1, new UsersCrudRouter().router()); // CRUD (no create here)

    // 6) Final problem handler (preserves 4xx from controllers)
    this.app.use(
      problem as unknown as (
        err: unknown,
        req: Request,
        res: Response,
        next: NextFunction
      ) => void
    );
  }
}
