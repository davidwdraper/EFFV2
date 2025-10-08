// backend/services/auth/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope & Routes)
 *   - ADR-0014 (ServiceEntrypoint → AppBase → ServiceBase)
 *
 * Purpose:
 * - Auth service app class expected by Bootstrap: `new AuthApp()`.
 * - Standard pipeline: health → json → responseErrorLogger → routes → problem.
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { problem } from "@nv/shared/middleware/problem";
import authRouter from "./routes/auth.route";

const SERVICE = process.env.SVC_NAME?.trim() || "auth";

export class AuthApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  /** Compatibility with existing launchers that expect `.instance`. */
  public get instance() {
    return this.app;
  }

  protected configure(): void {
    const baseV1 = `/api/${this.service}/v1`;

    // 1) Versioned health FIRST
    this.mountVersionedHealth(baseV1);

    // 2) JSON body parser
    this.app.use(express.json({ limit: "1mb" }));

    // 3) One-line completion/error logger
    this.app.use(responseErrorLogger(this.service));

    // 4) Versioned APIs (router is RELATIVE; do NOT prefix /v1 inside it)
    this.app.use(baseV1, authRouter);

    // 5) Final error sink (preserves 4xx from controllers)
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

export default AuthApp;
