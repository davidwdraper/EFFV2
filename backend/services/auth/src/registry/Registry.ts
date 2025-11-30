// backend/services/auth/src/registry/Registry.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *
 * Purpose:
 * - Per-service DTO Registry that **extends ServiceRegistryBase**:
 *   • single source of truth for DTO constructors (ctorByType)
 *   • inherits hydratorFor(), ensureIndexes(), listRegistered()
 *
 * Invariants:
 * - One registry per service.
 * - No reflection or dynamic imports — explicit ctor map only.
 * - Instance collection name is seeded from each DTO class's dbCollectionName()
 *   for DTOs that participate in persistence.
 */

import { DtoBase } from "@nv/shared/dto/DtoBase";
import { AuthDto } from "@nv/shared/dto/auth.dto";
import { ServiceRegistryBase } from "@nv/shared/registry/ServiceRegistryBase";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoCtor } from "@nv/shared/registry/RegistryBase";

export class Registry extends ServiceRegistryBase {
  /** Shared secret used by DTO constructors that enforce instantiation discipline. */
  private readonly secret = DtoBase.getSecret();

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "auth").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      ["auth"]: AuthDto as unknown as DtoCtor<IDto>,
      // add new DTOs here as you grow the service:
      // "my-type": MyDto as unknown as DtoCtor<IDto>,
    };
  }

  /**
   * Hook for attaching UserType (and any other per-request security context)
   * to a DTO instance.
   *
   * Auth v1:
   * - No field-level security or per-user shaping yet.
   * - DTOs are passed through unchanged.
   *
   * Later, when Auth starts shaping data by UserType/roles, this is the place
   * to attach that context or adjust DTO views.
   */
  protected applyUserType<T extends IDto = IDto>(dto: T): T {
    return dto;
  }

  // ─────────────── Convenience constructors (optional) ───────────────

  /** Create a new AuthDto instance. */
  public newAuthDto(): AuthDto {
    const dto = new AuthDto(this.secret);
    // MOS: no collection needed for auth v1.
    // dto.setCollectionName(AuthDto.dbCollectionName());
    return dto;
  }

  /** Hydrate an AuthDto from JSON (validates if requested). */
  public fromJsonAuth(json: unknown, opts?: { validate?: boolean }): AuthDto {
    const dto = AuthDto.fromBody(json, { validate: !!opts?.validate });
    // MOS: no collection needed for auth v1.
    // dto.setCollectionName(AuthDto.dbCollectionName());
    return dto;
  }
}
