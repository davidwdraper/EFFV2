// backend/services/audit/src/mappers/audit.record.mappers.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0022-shared-wal-and-db-base
 *   - adr0024-audit-wal-persistence-guarantee (append-only)
 *
 * Purpose:
 * - Helpers to construct FINAL audit records from entry pairs.
 * - Centralizes legacy END normalization (status/httpCode inference).
 *
 * Contract:
 * - Emits only AuditRecordJson (shared contract).
 * - No store-specific shapes or states.
 */

import { AuditEntryContract } from "@nv/shared/contracts/audit/audit.entry.contract";
import {
  AuditRecordContract,
  type AuditRecordJson,
} from "@nv/shared/contracts/audit/audit.record.contract";

/**
 * Normalize legacy END entries:
 * - If status is missing, infer from http.code/httpCode.
 * - If httpCode missing but http.code present, copy it up.
 * - Returns a new parsed entry; returns null if we cannot normalize (no code).
 */
export function normalizeEndIfNeeded(
  entry: AuditEntryContract
): AuditEntryContract | null {
  if (entry.phase !== "end") return entry;

  const j = entry.toJSON() as any;
  const hasStatus = typeof j.status === "string" && j.status.length > 0;

  // Prefer top-level httpCode; fallback to nested http.code (legacy)
  const code = Number.isFinite(j.httpCode)
    ? Number(j.httpCode)
    : Number.isFinite(j?.http?.code)
    ? Number(j.http.code)
    : undefined;

  if (!hasStatus) {
    if (!Number.isFinite(code)) {
      // Can't infer; skip this end entry
      return null;
    }
    j.status = (code as number) >= 400 ? "error" : "ok";
  }

  if (!Number.isFinite(j.httpCode) && Number.isFinite(code)) {
    j.httpCode = code;
  }

  // Clean up legacy nested http if we normalized
  if (j.http && Number.isFinite(code)) {
    delete j.http;
  }

  // Re-parse to enforce contract after normalization
  return AuditEntryContract.parse(j, "audit.mapper.normalize");
}

/**
 * Make a FINAL record from a begin/end pair.
 * - Applies END normalization first.
 * - Returns AuditRecordJson ready for append-only insert.
 */
export function makeFinalRecord(
  begin: AuditEntryContract,
  end: AuditEntryContract
): AuditRecordJson | null {
  const cleanEnd = normalizeEndIfNeeded(end);
  if (!cleanEnd) return null;

  return AuditRecordContract.fromEntries({
    begin,
    end: cleanEnd,
  }).toJSON();
}
