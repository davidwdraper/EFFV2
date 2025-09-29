// backend/services/act/src/mappers/act.mapper.ts
/**
 * Docs:
 * - Contracts: @eff/shared/src/contracts/act.contract.ts
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - (NEW) docs/adr/XXXX-entity-services-on-shared-createServiceApp.md
 *
 * Why:
 * - Make the shared Zod contract the single source of truth.
 * - Validate on the way in (domain → DB) and the way out (DB → domain).
 * - Keep DB-managed fields (_id, dates) write-protected.
 */

import { actContract, type Act } from "@eff/shared/src/contracts/act.contract";
import { clean } from "@eff/shared/src/contracts/clean";
import type { ActDocument } from "../models/Act";

/**
 * Convert a Mongoose document (or plain object) to the domain shape.
 * We validate with Zod so callers never see malformed data.
 *
 * NOTE: Mongo gives `_id` as an ObjectId; the contract expects a string.
 *       Normalize `_id` → string before parsing.
 */
export function dbToDomain(input: ActDocument | unknown): Act {
  const raw =
    typeof (input as any)?.toObject === "function"
      ? (input as ActDocument).toObject({ getters: true })
      : (input as Record<string, unknown>);

  // Coerce _id to string when present (ObjectId → hex string)
  const idVal = (raw as any)?._id;
  const normalizedId =
    typeof idVal === "string"
      ? idVal
      : idVal?.toHexString?.()
      ? idVal.toHexString()
      : idVal?.toString?.()
      ? idVal.toString()
      : idVal !== undefined
      ? String(idVal)
      : undefined;

  const obj = normalizedId !== undefined ? { ...raw, _id: normalizedId } : raw;

  return actContract.parse(obj);
}

/**
 * Prepare a (partial) domain object for persistence.
 * - Validates against the contract (partial writes are allowed upstream via DTOs;
 *   here we accept Partial<Act> but Zod will enforce correctness of provided fields).
 * - Strips DB-managed fields so they can’t be set by callers.
 */
export function domainToDb(partial: Partial<Act>): Record<string, unknown> {
  // Validate the *provided* fields by intersecting with the contract’s keys.
  // For full creates, upstream should validate with actContract before calling this.
  const provided = Object.fromEntries(
    Object.entries(partial).filter(([, v]) => v !== undefined)
  );

  // When creating/updating, we still run through the contract for safety.
  // For partials, parse will fail if a provided field is invalid (good).
  // We don’t require missing fields here (repo/service layer decides create vs update).
  const validated = actContract.partial().parse(provided);

  // Never allow callers to set DB-managed fields
  delete (validated as any)._id;
  delete (validated as any).dateCreated;
  delete (validated as any).dateLastUpdated;

  // Keep storage shape compact and stable
  return clean(validated as Record<string, unknown>);
}
