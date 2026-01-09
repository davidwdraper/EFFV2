// backend/services/env-service/src/registry/Registry.ts
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
import { DbEnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { ServiceRegistryBase } from "@nv/shared/registry/ServiceRegistryBase";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoCtor } from "@nv/shared/registry/DtoRegistry";

export class Registry extends ServiceRegistryBase {
  /** Shared secret used by DTO constructors that enforce instantiation discipline. */
  private readonly secret = DtoBase.getSecret();

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "env-service").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      // template default DTO
      ["env-service"]: DbEnvServiceDto as unknown as DtoCtor<IDto>,
      // add new DTOs here as you grow the service:
      // "my-type": MyDto as unknown as DtoCtor<IDto>,
    };
  }

  /**
   * Hook for attaching UserType (and any other per-request security context)
   * to a DTO instance.
   *
   * env-service v1:
   * - DbEnvServiceDto is purely configuration data, not user-shaped.
   * - There is no field-level security or per-user view adjustment.
   * - DTOs are passed through unchanged.
   *
   * If we ever introduce user-shaped views of env config, this is where that
   * logic will live.
   */
  protected applyUserType<T extends IDto = IDto>(dto: T): T {
    return dto;
  }

  // ─────────────── Convenience constructors (optional) ───────────────

  /** Create a new DbEnvServiceDto instance with a seeded collection. */
  public newDbEnvServiceDto(): DbEnvServiceDto {
    const dto = new DbEnvServiceDto(this.secret);
    dto.setCollectionName(DbEnvServiceDto.dbCollectionName());
    return dto;
  }

  /** Hydrate an DbEnvServiceDto from JSON (validates if requested) and seed collection. */
  public fromJsonEnvService(
    json: unknown,
    opts?: { validate?: boolean }
  ): DbEnvServiceDto {
    const dto = DbEnvServiceDto.fromBody(json, { validate: !!opts?.validate });
    dto.setCollectionName(DbEnvServiceDto.dbCollectionName());
    return dto;
  }
}
