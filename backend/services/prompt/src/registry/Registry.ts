// backend/services/prompt/src/registry/Registry.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0075 (Controller seeds dtoCtor for db.* read handlers)
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
 * - applyUserType() is explicitly implemented (no-op for prompt DTOs).
 */

import { DtoBase } from "@nv/shared/dto/DtoBase";
import { PromptDto } from "@nv/shared/dto/prompt.dto";
import { ServiceRegistryBase } from "@nv/shared/registry/ServiceRegistryBase";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoCtor } from "@nv/shared/registry/RegistryBase";

export class Registry extends ServiceRegistryBase {
  /** Shared secret used by DTO constructors that enforce instantiation discipline. */
  private readonly secret = DtoBase.getSecret();

  /**
   * Prompt DTOs do not participate in field-level security today.
   * Explicit no-op implementation satisfies ServiceRegistryBase contract.
   */
  protected applyUserType<T extends IDto = IDto>(dto: T): T {
    return dto;
  }

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "prompt").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      ["prompt"]: PromptDto as unknown as DtoCtor<IDto>,
      // add new DTOs here as you grow the service:
      // "my-type": MyDto as unknown as DtoCtor<IDto>,
    };
  }

  // ─────────────── Convenience constructors (optional) ───────────────

  /** Create a new PromptDto instance with a seeded collection. */
  public newPromptDto(): PromptDto {
    const dto = new PromptDto(this.secret);
    dto.setCollectionName(PromptDto.dbCollectionName());
    return dto;
  }

  /** Hydrate a PromptDto from JSON (validates if requested) and seed collection. */
  public fromJsonPrompt(
    json: unknown,
    opts?: { validate?: boolean }
  ): PromptDto {
    const dto = PromptDto.fromBody(json, { validate: !!opts?.validate });
    dto.setCollectionName(PromptDto.dbCollectionName());
    return dto;
  }
}
