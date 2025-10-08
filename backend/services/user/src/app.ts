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
 * - Health/ordering/middleware sequencing inherited from AppBase.
 * - Versioned APIs mounted under /api/<SVC_NAME>/v1.
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

  /** Versioned health base path (required per SOP). */
  protected healthBasePath(): string | null {
    return V1_BASE;
  }

  /**
   * Parsers: workers get JSON by default via AppBase; we also unwrap S2S envelopes here.
   * Keep gateway-specific parsing out of here (gateway streams bodies).
   */
  protected mountParsers(): void {
    super.mountParsers(); // express.json()
    this.app.use(unwrapEnvelope()); // flatten S2S envelopes → DTOs
  }

  /** Routes mounted after base pre/security/parsers. Keep routes one-liners. */
  protected mountRoutes(): void {
    this.app.use(V1_BASE, new UserS2SRouter().router()); // S2S endpoints
    this.app.use(V1_BASE, new UsersCrudRouter().router()); // CRUD endpoints
  }
}
