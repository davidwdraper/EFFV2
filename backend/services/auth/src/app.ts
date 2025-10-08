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
 * - Inherits all `app.use(...)` ordering from AppBase:
 *   health → preRouting (responseErrorLogger) → security → parsers (JSON) → routes → postRouting.
 * - Service override surface is kept tiny to prevent drift.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import authRouter from "./routes/auth.route";

const SERVICE = process.env.SVC_NAME?.trim() || "auth";
const V1_BASE = `/api/${SERVICE}/v1`;

export class AuthApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  /** Versioned health base path (required per SOP). */
  protected healthBasePath(): string | null {
    return V1_BASE;
  }

  /** Routes mounted after base pre/security/parsers. Keep routes one-liners. */
  protected mountRoutes(): void {
    // Routes are RELATIVE inside the router (no /v1 prefix there).
    this.app.use(V1_BASE, authRouter);
  }
}

export default AuthApp;
