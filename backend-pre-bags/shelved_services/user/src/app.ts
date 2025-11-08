// backend/services/user/src/app.ts
/**
 * NowVibin (NV)
 * File: backend/services/user/src/app.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 — Versioned Health Envelope & Routes
 *   - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 *   - ADR-0019 — Class Routers via RouterBase
 *   - ADR-0021 — User Opaque Password Hash
 *
 * Purpose:
 * - Orchestrates the User service runtime.
 * - Inherits full lifecycle and middleware sequencing from AppBase:
 *     onBoot → health → preRouting → security → parsers → routes → postRouting
 * - Adds S2S envelope unwrapping between JSON parser and route mounting.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { unwrapEnvelope } from "@nv/shared/middleware/unwrapEnvelope";
import { UsersCrudRouter } from "./routes/users.crud.routes";
import { UserS2SRouter } from "./routes/s2s.auth.routes";

const SERVICE = "user";
const V1_BASE = `/api/${SERVICE}/v1`;

export class UserApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  /** Versioned health base path (mounted automatically by AppBase). */
  protected healthBasePath(): string | null {
    return V1_BASE;
  }

  /**
   * Parser chain:
   * - JSON body parsing (from AppBase)
   * - S2S envelope unwrapping → DTO-ready bodies for handlers
   */
  protected mountParsers(): void {
    super.mountParsers(); // express.json()
    this.app.use(unwrapEnvelope());
  }

  /** Versioned routes — keep one-liners for clarity. */
  protected mountRoutes(): void {
    this.app.use(V1_BASE, new UserS2SRouter().router()); // internal S2S routes
    this.app.use(V1_BASE, new UsersCrudRouter().router()); // CRUD routes
  }
}
