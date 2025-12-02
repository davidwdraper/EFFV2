// backend/services/user-auth/src/registry/Registry.ts
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
 * - Instance collection name is seeded from each DTO class's dbCollectionName().
 */

import { DtoBase } from "@nv/shared/dto/DtoBase";
import { UserAuthDto } from "@nv/shared/dto/user-auth.dto";
import { ServiceRegistryBase } from "@nv/shared/registry/ServiceRegistryBase";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoCtor } from "@nv/shared/registry/RegistryBase";

export class Registry extends ServiceRegistryBase {
  /** Shared secret used by DTO constructors that enforce instantiation discipline. */
  private readonly secret = DtoBase.getSecret();

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "user-auth").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      ["user-auth"]: UserAuthDto as unknown as DtoCtor<IDto>,
      // Add new DTOs here as the service grows:
      // "my-type": MyDto as unknown as DtoCtor<IDto>,
    };
  }

  /**
   * Hook for attaching UserType (and other per-request security context)
   * to a DTO instance.
   *
   * The user-auth template does not apply field-level security by default,
   * so this implementation is a strict pass-through.
   */
  protected applyUserType<T extends IDto = IDto>(dto: T): T {
    return dto;
  }

  // ─────────────── Convenience constructors (optional) ───────────────

  /** Create a new UserAuthDto instance with a seeded collection. */
  public newUserAuthDto(): UserAuthDto {
    const dto = new UserAuthDto(this.secret);
    dto.setCollectionName(UserAuthDto.dbCollectionName());
    return dto;
  }

  /** Hydrate an UserAuthDto from JSON (validates if requested) and seed collection. */
  public fromJsonUserAuth(json: unknown, opts?: { validate?: boolean }): UserAuthDto {
    const dto = UserAuthDto.fromJson(json, {
      validate: !!opts?.validate,
    });
    dto.setCollectionName(UserAuthDto.dbCollectionName());
    return dto;
  }
}
