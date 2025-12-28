// backend/services/shared/src/dto/registry/user-auth.dtoRegistry.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak outside DTO/Registry rails.
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *
 * Purpose:
 * - Shared minting/instantiation registry for UserAuthDto.
 * - Lives in `shared` so MOS/edge services (auth, test-runner, etc.) can mint
 *   UserAuthDto instances without depending on the user-auth service Registry.
 *
 * Invariants:
 * - Instantiation discipline is enforced via DtoBase secret.
 * - Instance collection name is seeded from UserAuthDto.dbCollectionName().
 * - No service-specific concerns here (no indexes, no env, no logging).
 */

import { DtoBase } from "../DtoBase";
import { UserAuthDto } from "../user-auth.dto";
import type { IDto } from "../IDto";
import { RegistryBase, type DtoCtor } from "../../registry/RegistryBase";

export class UserAuthDtoRegistry extends RegistryBase {
  /** Shared secret used by DTO constructors that enforce instantiation discipline. */
  private readonly secret = DtoBase.getSecret();

  /**
   * Explicit map of registry type keys → DTO constructors.
   * Keys are the stable wire/type identifiers (e.g., "user-auth").
   */
  protected ctorByType(): Record<string, DtoCtor<IDto>> {
    return {
      ["user-auth"]: UserAuthDto as unknown as DtoCtor<IDto>,
    };
  }

  // ─────────────── Convenience minting helpers ───────────────

  /** Create a new UserAuthDto instance with a seeded collection. */
  public newUserAuthDto(): UserAuthDto {
    const dto = new UserAuthDto(this.secret);
    dto.setCollectionName(UserAuthDto.dbCollectionName());
    return dto;
  }

  /** Hydrate a UserAuthDto from JSON (validates if requested) and seed collection. */
  public fromJsonUserAuth(
    json: unknown,
    opts?: { validate?: boolean }
  ): UserAuthDto {
    const dto = UserAuthDto.fromBody(json, {
      validate: !!opts?.validate,
    });
    dto.setCollectionName(UserAuthDto.dbCollectionName());
    return dto;
  }
}
