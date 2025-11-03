// backend/services/shared/src/dto/registry/secret.ts
/**
 * Docs:
 * - SOP: DTO-first; single construction path via registry
 * - ADRs:
 *   - ADR-0049 (DtoBag as edge payload; DTO Registry; ID normalization)
 *
 * Purpose:
 * - Provides a process-wide secret symbol used to prove that a DTO
 *   is being instantiated via the DtoRegistry, not ad-hoc.
 *
 * Notes:
 * - Do NOT import this from application code. Only DTOs and the registry
 *   should reference this, to enforce the one construction path.
 */

export const DTO_REGISTRY_SECRET = Symbol.for("@nv/dto-registry-secret");
