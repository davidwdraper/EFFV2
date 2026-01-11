// backend/services/handler-test/src/registry/Registry.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *
 * Purpose:
 * - Per-service DTO Registry that **extends ServiceRegistryBase**:
 *   • single source of truth for DTO constructors (ctorByType)
 *   • inherits hydratorFor(), listRegistered()
 *
 * Invariants:
 * - One registry per service.
 * - No reflection or dynamic imports — explicit ctor map only.
 * - Instance collection name is seeded from each DTO class's dbCollectionName().
 *
 * Notes:
 * - Minting/instantiation helpers are implemented in the shared
 *   HandlerTestDtoRegistry so other services (e.g., test-runner) can mint
 *   HandlerTestDto without reaching into this service. This Registry delegates
 *   its convenience methods to that shared registry.
 */

import { HandlerTestDto } from "@nv/shared/dto/db.handler-test.dto";
import { HandlerTestDtoRegistry } from "@nv/shared/dto/registry/handler-test.dtoRegistry";
import { ServiceRegistryBase } from "@nv/shared/registry/ServiceRegistryBase";
import type { IDto } from "backend/services/packages/dto/core/IDto";
import type { DtoCtor } from "@nv/shared/registry/DtoRegistry";

export class Registry extends ServiceRegistryBase {
  /** Shared minting registry used for convenience constructors. */
  private readonly minting = new HandlerTestDtoRegistry();

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

  // ─────────────── Convenience constructors (delegate to shared) ───────────────

  /** Create a new HandlerTestDto instance with a seeded collection. */
  public newHandlerTestDto(): HandlerTestDto {
    return this.minting.newHandlerTestDto();
  }

  /** Hydrate a HandlerTestDto from JSON (validates if requested) and seed collection. */
  public fromJsonHandlerTest(
    json: unknown,
    opts?: { validate?: boolean }
  ): HandlerTestDto {
    return this.minting.fromJsonHandlerTest(json, opts);
  }
}
