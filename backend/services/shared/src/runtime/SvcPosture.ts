// backend/services/shared/src/runtime/SvcPosture.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Single source of truth for what a service IS allowed to own.
 * - Used to derive boot-time rails and enforce legality (no “works by accident”).
 *
 * Invariants:
 * - Only posture="db" owns a DB and performs DB writes.
 * - All DB writes are WAL-backed => db posture requires filesystem backing for WAL.
 */

export type SvcPosture = "db" | "mos" | "api" | "fs" | "stream";

export function isDbPosture(p: SvcPosture): boolean {
  return p === "db";
}

export function requiresWalFs(p: SvcPosture): boolean {
  // ADR-0084: All DB writes WAL => db posture always requires FS for WAL.
  return p === "db";
}
