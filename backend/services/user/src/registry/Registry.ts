// backend/services/user/src/registry/Registry.ts
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

import { UserDto } from "@nv/shared/dto/user.dto";
import { ServiceRegistryBase } from "@nv/shared/registry/ServiceRegistryBase";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoCtor } from "@nv/shared/registry/RegistryBase";
import { UserDtoRegistry } from "@nv/shared/dto/registry/user.dtoRegistry";

export class Registry extends ServiceRegistryBase {
  /**
   * Shared user DTO registry:
   * - Instantiation helpers live in shared (UserDtoRegistry).
   * - This service registry focuses on service-local concerns
   *   (index hints, persistence, etc.).
   */
  private readonly userRegistry = new UserDtoRegistry();

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "user").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      ["user"]: UserDto as unknown as DtoCtor<IDto>,
      // Add new DTOs here as the service grows:
      // "my-type": MyDto as unknown as DtoCtor<IDto>,
    };
  }

  /**
   * Hook for attaching UserType (and other per-request security context)
   * to a DTO instance.
   *
   * The user template does not apply field-level security by default,
   * so this implementation is a strict pass-through.
   */
  protected applyUserType<T extends IDto = IDto>(dto: T): T {
    return dto;
  }

  // ─────────────── Convenience constructors (delegated) ───────────────

  /** Create a new UserDto instance with a seeded collection. */
  public newUserDto(): UserDto {
    return this.userRegistry.newUserDto();
  }

  /** Hydrate a UserDto from JSON (validates if requested) and seed collection. */
  public fromJsonUser(json: unknown, opts?: { validate?: boolean }): UserDto {
    return this.userRegistry.fromJsonUser(json, opts);
  }
}
