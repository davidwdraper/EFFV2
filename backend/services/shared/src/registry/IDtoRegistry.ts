// backend/services/shared/src/registry/IDtoRegistry.ts
/**
 * Docs:
 * - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 * - ADR-0106 (Lazy index ensure via persistence IndexGate)
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
 * Index ensure (ADR-0106):
 * - The registry has NO index-related surface area.
 * - Index ensuring is a persistence-boundary concern via IndexGate.
 */

import type { DtoBase } from "../dto/DtoBase";
import type { IDto } from "../../../packages/dto/core/IDto";

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
}
