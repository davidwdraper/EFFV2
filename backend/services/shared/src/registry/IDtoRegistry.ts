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
 */

import type { DtoBase } from "../dto/DtoBase";
import type { IDto } from "../dto/IDto";

export type RegistryDto = DtoBase & IDto;

export interface IDtoRegistry {
  create<TDto extends RegistryDto = RegistryDto>(
    key: string,
    body?: unknown,
    opts?: { validate?: boolean; mode?: "wire" | "db" }
  ): TDto;
}
