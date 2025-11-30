// backend/services/svcconfig/src/registry/Registry.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0060 (DTO Secure Access Layer)
 *
 * Purpose:
 * - Per-service DTO Registry that **extends ServiceRegistryBase**:
 *   • single source of truth for DTO constructors (ctorByType)
 *   • inherits hydratorFor(), ensureIndexes(), listRegistered()
 *   • applies per-request UserType to DTOs that participate in field-level security
 *
 * Invariants:
 * - One registry per service.
 * - No reflection or dynamic imports — explicit ctor map only.
 * - Instance collection name is seeded from each DTO class's dbCollectionName().
 */

import { DtoBase, UserType } from "@nv/shared/dto/DtoBase";
import { SvcconfigDto } from "@nv/shared/dto/svcconfig.dto";
import { ServiceRegistryBase } from "@nv/shared/registry/ServiceRegistryBase";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoCtor } from "@nv/shared/registry/RegistryBase";

export class Registry extends ServiceRegistryBase {
  /** Shared secret used by DTO constructors that enforce instantiation discipline. */
  private readonly secret = DtoBase.getSecret();

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "svcconfig").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      ["svcconfig"]: SvcconfigDto as unknown as DtoCtor<IDto>,
      // add new DTOs here as you grow the service:
      // "my-type": MyDto as unknown as DtoCtor<IDto>,
    };
  }

  /**
   * Attach UserType / security context to DTO instances created by this registry.
   *
   * For now, svcconfig operates as an admin-only configuration service, so we
   * treat all registry-created DTOs as if they are being manipulated by
   * AdminRoot. Once JWT-based auth is in place, this method will be updated to
   * derive the UserType from the request/auth context.
   */
  protected applyUserType<T extends IDto>(dto: T): T {
    if (dto instanceof DtoBase) {
      dto.setCurrentUserType(UserType.AdminRoot);
    }
    return dto;
  }

  // ─────────────── Convenience constructors (optional) ───────────────

  /** Create a new SvcconfigDto instance with a seeded collection and user context. */
  public newSvcconfigDto(): SvcconfigDto {
    const dto = new SvcconfigDto(this.secret);
    dto.setCollectionName(SvcconfigDto.dbCollectionName());
    return this.applyUserType(dto);
  }

  /**
   * Hydrate an SvcconfigDto from JSON (validates if requested), seed collection,
   * and apply user context.
   */
  public fromJsonSvcconfig(
    json: unknown,
    opts?: { validate?: boolean }
  ): SvcconfigDto {
    const dto = SvcconfigDto.fromBody(json, { validate: !!opts?.validate });
    dto.setCollectionName(SvcconfigDto.dbCollectionName());
    return this.applyUserType(dto);
  }
}
