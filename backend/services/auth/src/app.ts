// backend/services/auth/src/app.ts
/**
 * NowVibin (NV)
 * File: backend/services/auth/src/app.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 — Versioned Health Envelope & Routes
 *   - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 *
 * Purpose:
 * - Orchestrates the Auth service runtime sequence.
 * - Inherits lifecycle and middleware order from AppBase:
 *     onBoot → health → preRouting → security → parsers → routes → postRouting
 * - Environment-invariant: no literals; all config via env vars.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { AuthRouter } from "./routes/auth.router";

const SERVICE_SLUG = "auth";

export class AuthApp extends AppBase {
  constructor() {
    super({ service: SERVICE_SLUG });
  }

  /** Versioned health base path (required per SOP). */
  protected healthBasePath(): string | null {
    return `/api/${SERVICE_SLUG}/v1`;
  }

  /** Wire routes; all other middleware order inherited from AppBase. */
  protected mountRoutes(): void {
    this.app.use(`/api/${SERVICE_SLUG}/v1`, new AuthRouter().router());
  }
}

export default AuthApp;
