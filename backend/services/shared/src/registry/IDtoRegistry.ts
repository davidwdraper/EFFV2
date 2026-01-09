// backend/services/shared/src/registry/IDtoRegistry.ts
/**
 * Docs:
 * - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
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
 */

import type { DtoBase } from "../dto/DtoBase";
import type { IDto } from "../dto/IDto";

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
