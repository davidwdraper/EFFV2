// backend/services/shared/src/registry/dtoInstantiationSecret.ts
/**
 * Docs:
 * - SOP: shared utilities; deterministic; no fallbacks
 * - ADRs:
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *
 * Purpose:
 * - Single instantiation secret used by DtoRegistry + all ctor-injection DTOs.
 * - This replaces the legacy RegistryBase-held secret so RegistryBase can be deleted.
 */

export const DTO_INSTANTIATION_SECRET = Symbol(
  "NvDtoRegistryInstantiationSecret"
);
