// backend/services/shared/contracts/audit/audit.blob.contract.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Canonical **opaque** audit record for WAL ingestion and transport.
 * - Destination-agnostic (DB/HTTP/etc. — writer decides).
 *
 * Canonical Shape (STRICT):
 * {
 *   meta: {
 *     service: string,         // producing service slug ("gateway", "audit", etc.)
 *     ts: number,              // epoch ms WHEN PRODUCED (not when appended)
 *     requestId: string        // end-to-end correlation id
 *   },
 *   blob: unknown,             // opaque payload (sanitized upstream)
 *   phase?: string,            // optional semantic hint
 *   target?: { slug, version, route, method } // optional observability context
 * }
 *
 * Notes:
 * - WAL and writers **must** rely on this shape; no alternative locations.
 * - No environment literals. No DB schema here.
 * - Keep tiny & stable; everything imports this (no duplicates).
 */

import { z } from "zod";

// ── Sub-shapes (kept inline; no barrels) ─────────────────────────────────────
export const AuditTargetSchema = z.object({
  slug: z.string().min(1), // e.g., "act"
  version: z.number().int().nonnegative(), // API major version (e.g., 1)
  route: z.string().min(1), // e.g., "/api/acts"
  method: z.string().min(1), // e.g., "PUT" | "POST" | ...
});
export type AuditTarget = z.infer<typeof AuditTargetSchema>;

export const AuditMetaSchema = z.object({
  service: z.string().min(1),
  ts: z.number().int().nonnegative(),
  requestId: z.string().min(1),
});
export type AuditMeta = z.infer<typeof AuditMetaSchema>;

// ── Canonical opaque blob (STRICT) ───────────────────────────────────────────
export const AuditBlobSchema = z.object({
  /** Required canonical metadata. */
  meta: AuditMetaSchema,

  /** Redacted/structured data. No secrets — sanitize upstream. */
  blob: z.unknown(),

  /** Optional semantic hint; engine/writer do not branch on this. */
  phase: z.string().min(1).optional(),

  /** Optional target info for observability (opaque to WAL/writer). */
  target: AuditTargetSchema.optional(),
});
export type AuditBlob = z.infer<typeof AuditBlobSchema>;

// ── Batch wrapper for transport (kept minimal) ───────────────────────────────
export const AuditBatchSchema = z.object({
  entries: z.array(AuditBlobSchema).min(1),
});
export type AuditBatch = z.infer<typeof AuditBatchSchema>;

// ── Helpers (narrow parsing with good error messages) ────────────────────────
export function parseAuditBlob(input: unknown): AuditBlob {
  const res = AuditBlobSchema.safeParse(input);
  if (!res.success) {
    const first = res.error.issues[0];
    const where = first?.path?.join(".") || "<root>";
    const msg = first?.message || "invalid audit blob";
    const err = new Error(`AuditBlob invalid at ${where}: ${msg}`);
    (err as any).code = "AUDIT_BLOB_INVALID";
    (err as any).issues = res.error.issues;
    throw err;
  }
  return res.data;
}

export function parseAuditBatch(input: unknown): AuditBatch {
  const res = AuditBatchSchema.safeParse(input);
  if (!res.success) {
    const first = res.error.issues[0];
    const where = first?.path?.join(".") || "<root>";
    const msg = first?.message || "invalid audit batch";
    const err = new Error(`AuditBatch invalid at ${where}: ${msg}`);
    (err as any).code = "AUDIT_BATCH_INVALID";
    (err as any).issues = res.error.issues;
    throw err;
  }
  return res.data;
}
