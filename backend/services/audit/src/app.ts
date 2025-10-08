// backend/services/audit/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope & Routes)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *   - ADR-0019 (Class Routers via RouterBase)
 *   - adr0022-shared-wal-and-db-base (Audit ingress via WAL, background flush)
 *
 * Purpose:
 * - Audit service on AppBase.
 * - Versioned APIs mounted under /api/audit/v1.
 * - Health first; parsers next; routes are one-liners.
 *
 * Notes:
 * - We only need JSON body parsing here (no gateway unwrap/streaming).
 * - Gatekeeping/auth will sit in front (gateway). This service ingests batches.
 */

import { AppBase } from "@nv/shared/base/AppBase";
// No unwrapEnvelope here; gateway uses envelopes, not this service.
import { AuditIngestRouter } from "./routes/audit.ingest.routes";

const SERVICE = "audit" as const;
const V1_BASE = `/api/${SERVICE}/v1`;

export class AuditApp extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  /** Versioned health base path (required per SOP). */
  protected healthBasePath(): string | null {
    return V1_BASE;
  }

  /** Parsers: default JSON parser from AppBase is sufficient. */
  protected mountParsers(): void {
    super.mountParsers(); // express.json()
  }

  /** Routes mounted after base pre/security/parsers. Keep routes one-liners. */
  protected mountRoutes(): void {
    // Ingest batches of audit entries
    this.app.use(V1_BASE, new AuditIngestRouter().router());
  }
}
