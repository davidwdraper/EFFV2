// backend/services/shared/contracts/audit/audit.ack.contract.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Canonical ACK envelope for audit ingest APIs.
 * - Keeps HTTP response shapes consistent across services/tests.
 *
 * Design:
 * - Minimal, stable fields only. No transport/runtime noise.
 * - Pairs with `AuditBatch` request shape from `audit.blob.contract.ts`.
 */

import { z } from "zod";

export const AuditIngestAckDataSchema = z.object({
  accepted: z.number().int().nonnegative(),
});

export type AuditIngestAckData = z.infer<typeof AuditIngestAckDataSchema>;

export const AuditIngestAckSchema = z.object({
  ok: z.literal(true),
  service: z.string().min(1),
  data: AuditIngestAckDataSchema,
});

export type AuditIngestAck = z.infer<typeof AuditIngestAckSchema>;

/** Narrow parser for controller/unit tests. Throws compact, useful errors. */
export function parseAuditIngestAck(input: unknown): AuditIngestAck {
  const res = AuditIngestAckSchema.safeParse(input);
  if (!res.success) {
    const first = res.error.issues[0];
    const where = first?.path?.join(".") || "<root>";
    const msg = first?.message || "invalid audit ingest ack";
    const err = new Error(`AuditIngestAck invalid at ${where}: ${msg}`);
    (err as any).code = "AUDIT_INGEST_ACK_INVALID";
    (err as any).issues = res.error.issues;
    throw err;
  }
  return res.data;
}
