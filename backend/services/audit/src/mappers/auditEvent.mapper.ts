// backend/services/audit/src/mappers/auditEvent.mapper.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 * - Scaling: docs/architecture/backend/SCALING.md
 *
 * Why:
 * - Today, AuditEvent domain == DB == wire. We keep a mapper anyway to:
 *   1) enforce the canonical Zod contract at boundaries,
 *   2) strip undefineds (stable storage shape),
 *   3) give us a seam if storage diverges later (e.g., switch ts→Date).
 *
 * Note:
 * - This mapper is intentionally minimal (no field renames). It’s a safety harness,
 *   not a transformation engine. Repo can pass through domain objects directly.
 */

import {
  auditEventContract,
  type AuditEvent,
} from "@shared/src/contracts/auditEvent.contract";
import { clean } from "@shared/src/contracts/clean";

/**
 * Validate + normalize a domain AuditEvent before DB insertion.
 * Currently a pass-through with strict validation and undefined stripping.
 */
export function domainToDb(input: unknown): Record<string, unknown> {
  // Validate strictly against the canonical contract.
  const e = auditEventContract.parse(input);

  // Keep the storage shape stable and compact.
  const out = clean({ ...e });

  // If in the future we change representation (e.g., ts as Date), this is the hook.
  return out;
}

/**
 * Convert a lean DB document back to the domain shape.
 * Also validates the document so callers never see a malformed event.
 */
export function dbToDomain(doc: unknown): AuditEvent {
  // Validate and coerce (if any Zod coercions are added later).
  return auditEventContract.parse(doc);
}
