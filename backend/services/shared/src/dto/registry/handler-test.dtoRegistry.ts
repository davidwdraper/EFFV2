// backend/services/shared/src/dto/registry/handler-test.dtoRegistry.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak outside DTO/Registry rails.
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *
 * Purpose:
 * - Shared minting/instantiation registry for HandlerTestDto.
 * - Lives in `shared` so services like test-runner can mint HandlerTestDto
 *   instances without depending on the handler-test service's Registry.
 *
 * Invariants:
 * - Instantiation discipline is enforced via DtoBase secret.
 * - Instance collection name is seeded from HandlerTestDto.dbCollectionName().
 * - No service-specific concerns here (no indexes, no env, no logging).
 */

import { DtoBase } from "../DtoBase";
import { HandlerTestDto } from "../handler-test.dto";
import type { IDto } from "../IDto";
import { RegistryBase, type DtoCtor } from "../../registry/RegistryBase";

export class HandlerTestDtoRegistry extends RegistryBase {
  /** Shared secret used by DTO constructors that enforce instantiation discipline. */
  private readonly secret = DtoBase.getSecret();

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "handler-test").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      ["handler-test"]: HandlerTestDto as unknown as DtoCtor<IDto>,
    };
  }

  // ─────────────── Convenience minting helpers ───────────────

  /** Create a new HandlerTestDto instance with a seeded collection. */
  public newHandlerTestDto(): HandlerTestDto {
    const dto = new HandlerTestDto(this.secret);
    dto.setCollectionName(HandlerTestDto.dbCollectionName());
    return dto;
  }

  /** Hydrate a HandlerTestDto from JSON (validates if requested) and seed collection. */
  public fromJsonHandlerTest(
    json: unknown,
    opts?: { validate?: boolean }
  ): HandlerTestDto {
    const dto = HandlerTestDto.fromBody(json, {
      // Default mode is "wire"; explicit validate matches prior behavior.
      validate: !!opts?.validate,
    });
    dto.setCollectionName(HandlerTestDto.dbCollectionName());
    return dto;
  }
}
