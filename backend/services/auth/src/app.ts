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
 *   health → preRouting → security → parsers (JSON) → routes → postRouting.
 * - Environment-invariant: no host/IP/dev literals; only env vars/config differ.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { AuthRouter } from "./routes/auth.router";

const SERVICE = "auth"; // slug is fixed by SOP (no env overrides)

export class AuthApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  /** Versioned health base path (required per SOP). */
  protected healthBasePath(): string | null {
    return "/api/auth/v1";
  }

  /** Routes mounted after base pre/security/parsers. Keep routes one-liners. */
  protected mountRoutes(): void {
    this.app.use("/api/auth/v1", new AuthRouter().router());
  }
}

export default AuthApp;
