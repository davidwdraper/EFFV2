// backend/services/handler-test/src/registry/Registry.ts
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
import { HandlerTestDto } from "@nv/shared/dto/handler-test.dto";
import { ServiceRegistryBase } from "@nv/shared/registry/ServiceRegistryBase";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoCtor } from "@nv/shared/registry/RegistryBase";

export class Registry extends ServiceRegistryBase {
  /** Shared secret used by DTO constructors that enforce instantiation discipline. */
  private readonly secret = DtoBase.getSecret();

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "handler-test").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      ["handler-test"]: HandlerTestDto as unknown as DtoCtor<IDto>,
      // Add new DTOs here as the service grows:
      // "my-type": MyDto as unknown as DtoCtor<IDto>,
    };
  }

  /**
   * Hook for attaching UserType (and other per-request security context)
   * to a DTO instance.
   *
   * The handler-test template does not apply field-level security by default,
   * so this implementation is a strict pass-through.
   */
  protected applyUserType<T extends IDto = IDto>(dto: T): T {
    return dto;
  }

  // ─────────────── Convenience constructors (optional) ───────────────

  /** Create a new HandlerTestDto instance with a seeded collection. */
  public newHandlerTestDto(): HandlerTestDto {
    const dto = new HandlerTestDto(this.secret);
    dto.setCollectionName(HandlerTestDto.dbCollectionName());
    return dto;
  }

  /** Hydrate an HandlerTestDto from JSON (validates if requested) and seed collection. */
  public fromJsonHandlerTest(json: unknown, opts?: { validate?: boolean }): HandlerTestDto {
    const dto = HandlerTestDto.fromBody(json, {
      validate: !!opts?.validate,
    });
    dto.setCollectionName(HandlerTestDto.dbCollectionName());
    return dto;
  }
}
