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
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { ServiceRegistryBase } from "@nv/shared/registry/ServiceRegistryBase";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoCtor } from "@nv/shared/registry/RegistryBase";

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
      ["env-service"]: EnvServiceDto as unknown as DtoCtor<IDto>,
      // add new DTOs here as you grow the service:
      // "my-type": MyDto as unknown as DtoCtor<IDto>,
    };
  }

  // ─────────────── Convenience constructors (optional) ───────────────

  /** Create a new EnvServiceDto instance with a seeded collection. */
  public newEnvServiceDto(): EnvServiceDto {
    const dto = new EnvServiceDto(this.secret);
    dto.setCollectionName(EnvServiceDto.dbCollectionName());
    return dto;
  }

  /** Hydrate an EnvServiceDto from JSON (validates if requested) and seed collection. */
  public fromJsonEnvService(json: unknown, opts?: { validate?: boolean }): EnvServiceDto {
    const dto = EnvServiceDto.fromJson(json, { validate: !!opts?.validate });
    dto.setCollectionName(EnvServiceDto.dbCollectionName());
    return dto;
  }
}
