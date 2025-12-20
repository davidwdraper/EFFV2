// backend/services/shared/src/dto/registry/user.dtoRegistry.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak outside DTO/Registry rails.
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *
 * Purpose:
 * - Shared minting/instantiation registry for UserDto.
 * - Lives in `shared` so services (auth, test-runner, etc.) can mint UserDto
 *   instances without depending on the user service's Registry.
 *
 * Invariants:
 * - Instantiation discipline is enforced via DtoBase secret.
 * - Instance collection name is seeded from UserDto.dbCollectionName().
 * - No service-specific concerns here (no indexes, no env, no logging).
 */

import { DtoBase } from "../DtoBase";
import { UserDto } from "../user.dto";
import type { IDto } from "../IDto";
import { RegistryBase, type DtoCtor } from "../../registry/RegistryBase";

export class UserDtoRegistry extends RegistryBase {
  /** Shared secret used by DTO constructors that enforce instantiation discipline. */
  private readonly secret = DtoBase.getSecret();

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "user").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      ["user"]: UserDto as unknown as DtoCtor<IDto>,
    };
  }

  // ─────────────── Convenience minting helpers ───────────────

  /** Create a new UserDto instance with a seeded collection. */
  public newUserDto(): UserDto {
    const dto = new UserDto(this.secret);
    dto.setCollectionName(UserDto.dbCollectionName());
    return dto;
  }

  /** Hydrate a UserDto from JSON (validates if requested) and seed collection. */
  public fromJsonUser(json: unknown, opts?: { validate?: boolean }): UserDto {
    const dto = UserDto.fromBody(json, {
      validate: !!opts?.validate,
    });
    dto.setCollectionName(UserDto.dbCollectionName());
    return dto;
  }
}
