// backend/services/shared/src/runtime/SvcPosture.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Single source of truth for service posture.
 * - Posture is used to guard rails at boot (e.g., whether a service is expected
 *   to own a DB, require a registry, run DB index ensure, etc.).
 *
 * Definitions (user contract):
 * - "mos": orchestration-only service (S2S + business logic; no DB ownership)
 * - "db": dumb CRUD DB service (DtoBags in/out)
 * - "api": dumb wrapper over a commercial API (DtoBags in/out)
 * - "fs": file-system service (reserved)
 * - "stream": streaming service (reserved)
 * - "gateway": special case (not mos/db/api; edge proxy/router behavior)
 *
 * Notes:
 * - "infra" is NOT a posture. Infra-ness is a role/boot dependency, not a posture.
 */

export type SvcPosture = "mos" | "db" | "api" | "fs" | "stream" | "gateway";

/** True when the posture is expected to own a DB and run DB rails. */
export function isDbPosture(p: SvcPosture): boolean {
  return p === "db";
}

/** True when the posture is orchestration-only (no DB ownership). */
export function isMosPosture(p: SvcPosture): boolean {
  return p === "mos";
}

/** True when the posture is a “dumb adapter” layer (db or api). */
export function isAdapterPosture(p: SvcPosture): boolean {
  return p === "db" || p === "api";
}

/** True when posture is the special gateway posture. */
export function isGatewayPosture(p: SvcPosture): boolean {
  return p === "gateway";
}
