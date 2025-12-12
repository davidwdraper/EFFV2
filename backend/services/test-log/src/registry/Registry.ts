// backend/services/test-log/src/registry/Registry.ts
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
import { TestRunDto } from "@nv/shared/dto/test-run.dto";
import { TestHandlerDto } from "@nv/shared/dto/test-handler.dto";
import { ServiceRegistryBase } from "@nv/shared/registry/ServiceRegistryBase";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoCtor } from "@nv/shared/registry/RegistryBase";

export class Registry extends ServiceRegistryBase {
  /** Shared secret used by DTO constructors that enforce instantiation discipline. */
  private readonly secret = DtoBase.getSecret();

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "test-run").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      ["test-run"]: TestRunDto as unknown as DtoCtor<IDto>,
      ["test-handler"]: TestHandlerDto as unknown as DtoCtor<IDto>,
    };
  }

  /**
   * Hook for attaching UserType (and other per-request security context)
   * to a DTO instance.
   *
   * The test-log service does not apply field-level security by default,
   * so this implementation is a strict pass-through.
   */
  protected applyUserType<T extends IDto = IDto>(dto: T): T {
    return dto;
  }

  // ─────────────── Convenience constructors (optional) ───────────────
  // These helpers are sugar for controllers/handlers; they respect the
  // registry secret and seed the collection name consistently.

  /** Create a new TestRunDto instance with a seeded collection. */
  public newTestRunDto(): TestRunDto {
    const dto = new TestRunDto(this.secret);
    dto.setCollectionName(TestRunDto.dbCollectionName());
    return dto;
  }

  /** Hydrate a TestRunDto from JSON (validates if requested) and seed collection. */
  public fromJsonTestRun(
    json: unknown,
    opts?: { validate?: boolean }
  ): TestRunDto {
    const dto = TestRunDto.fromBody(json, {
      validate: !!opts?.validate,
    });
    dto.setCollectionName(TestRunDto.dbCollectionName());
    return dto;
  }

  /** Create a new TestHandlerDto instance with a seeded collection. */
  public newTestHandlerDto(): TestHandlerDto {
    const dto = new TestHandlerDto(this.secret);
    dto.setCollectionName(TestHandlerDto.dbCollectionName());
    return dto;
  }

  /** Hydrate a TestHandlerDto from JSON (validates if requested) and seed collection. */
  public fromJsonTestHandler(
    json: unknown,
    opts?: { validate?: boolean }
  ): TestHandlerDto {
    const dto = TestHandlerDto.fromBody(json, {
      validate: !!opts?.validate,
    });
    dto.setCollectionName(TestHandlerDto.dbCollectionName());
    return dto;
  }
}
