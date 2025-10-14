// backend/services/shared/src/writer/HttpAuditWriter.register.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Register the HttpAuditWriter with the dynamic WriterRegistry under the key "http".
 * - Zero environment reads here; pure registration for testability and invariance.
 */

import { registerWriter } from "./WriterRegistry";
import {
  HttpAuditWriter,
  type HttpAuditWriterOptions,
} from "./HttpAuditWriter";
import type { IAuditWriter } from "./IAuditWriter";

registerWriter<HttpAuditWriterOptions>(
  "http",
  (opts?: HttpAuditWriterOptions): IAuditWriter => {
    if (!opts) {
      throw new Error(
        "HttpAuditWriter.register: options are required (svcClient, auditSlug, auditVersion, etc.)"
      );
    }
    return new HttpAuditWriter(opts);
  },
  { builtin: true }
);

export type { HttpAuditWriterOptions } from "./HttpAuditWriter";
