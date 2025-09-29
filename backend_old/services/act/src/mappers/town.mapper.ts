// backend/services/act/src/mappers/town.mapper.ts
/**
 * Docs:
 * - Contracts: @eff/shared/src/contracts/town.contract.ts
 * - Why:
 *   - Validate with the shared Zod contract on ingress/egress.
 *   - Keep Mongoose free of duplicate validation logic.
 */

import {
  townContract,
  type Town,
} from "@eff/shared/src/contracts/town.contract";
import { clean } from "@eff/shared/src/contracts/clean";
import type { TownDocument } from "../models/Town";

/** DB → Domain: validate so callers never see malformed data */
export function dbToDomain(input: TownDocument | unknown): Town {
  const obj =
    typeof (input as any)?.toObject === "function"
      ? (input as TownDocument).toObject({ getters: true })
      : (input as Record<string, unknown>);

  return townContract.parse(obj);
}

/** Domain (partial allowed) → DB: validate provided fields; protect DB-managed */
export function domainToDb(partial: Partial<Town>): Record<string, unknown> {
  const provided = Object.fromEntries(
    Object.entries(partial).filter(([, v]) => v !== undefined)
  );

  // For partial updates we accept only the provided fields, but they must be valid.
  const validated = townContract.partial().parse(provided);

  // Never allow callers to change DB-managed identity
  if ("_id" in validated && typeof validated._id !== "string") {
    // normalize, but do not delete: _id string is legitimate on create
    (validated as any)._id = String((validated as any)._id);
  }

  return clean(validated as Record<string, unknown>);
}
