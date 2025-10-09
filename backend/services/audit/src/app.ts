// backend/services/audit/src/app.ts
/**
 * Docs:
 * - SOP: Core SOP (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope & Routes)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *   - ADR-0019 (Class Routers via RouterBase)
 *   - adr0022-shared-wal-and-db-base
 *
 * Purpose:
 * - Audit service on AppBase.
 * - Mounts versioned routes and starts the WAL flusher.
 *
 * Behavior:
 * - Will throw at boot if required DB env vars are missing (repo ctor uses requireEnv).
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { AuditIngestRouter } from "./routes/audit.ingest.routes";
import { AuditWalFlusher } from "./workers/audit.flusher";

const SERVICE = "audit" as const;
const V1_BASE = `/api/${SERVICE}/v1`;

export class AuditApp extends AppBase {
  private flusher: AuditWalFlusher | null = null;

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

    // Start WAL flusher last so health/parsers/routes are mounted first.
    // NOTE: This will cause a loud failure at startup if DB env vars are missing,
    // because AuditRepo (constructed by the flusher) requires them.
    this.flusher = new AuditWalFlusher();
    this.flusher.start();
  }
}
