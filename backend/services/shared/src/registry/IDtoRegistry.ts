// backend/services/shared/src/registry/IDtoRegistry.ts
/**
 * Docs:
 * - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 * - ADR-0045 (Index Hints — boot ensure via shared helper)
 *
 * Purpose:
 * - Single DTO registry contract for NV.
 * - Registry creates DTO instances that are BOTH:
 *   - DtoBase descendants (for id + collection plumbing)
 *   - IDto (for bags/wire/persistence contract)
 *
 * Notes:
 * - The registry key is the canonical DTO key (aka dtoKey).
 * - dtoKey replaces any legacy “type” notion (getType()).
 *
 * Index ensure:
 * - Registry does NOT perform DB work.
 * - It only exposes which registered db.* DTO CLASSES participate in
 *   boot-time index ensure (single concern: registration metadata).
 */

import type { DtoBase } from "../dto/DtoBase";
import type { IDto } from "../dto/IDto";
import type { DtoCtorWithIndexes } from "../dto/persistence/indexes/ensureIndexes";

export type RegistryDto = DtoBase & IDto;

export type DtoKey = string;

export type DtoCreateMode = "wire" | "db";

export type DtoCreateOptions = {
  validate?: boolean;
  mode?: DtoCreateMode;
};

export interface IDtoRegistry {
  create<TDto extends RegistryDto = RegistryDto>(
    dtoKey: DtoKey,
    body?: unknown,
    opts?: DtoCreateOptions
  ): TDto;

  /**
   * ADR-0045:
   * Return registered db.* DTO CLASSES that declare:
   *  - static indexHints: ReadonlyArray<IndexHint>
   *  - static dbCollectionName(): string
   *
   * Boot code passes this list into ensureIndexesForDtos(...).
   */
  listDbDtoCtorsForIndexes(): ReadonlyArray<DtoCtorWithIndexes>;
}
