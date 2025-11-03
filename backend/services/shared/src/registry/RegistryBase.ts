// backend/services/shared/src/registry/RegistryBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & Wire Discrimination; DTO-only validation)
 *
 * Purpose:
 * - Base class for per-service DTO registries.
 * - Provides a construction secret and a typed helper to call a DTO's fromJson().
 *
 * Notes:
 * - KISS: no runtime maps here. Concrete registries stay explicit.
 * - The 'instantiate' method is intentionally abstract-ish; services override it with a switch.
 */

import type { IDto } from "@nv/shared/dto/IDto";

/** Shared secret for guarded DTO construction (optional use inside DTOs). */
export const DTO_SECRET: unique symbol = Symbol("NV_DTO_SECRET");

/** Static fromJson signature each DTO class must expose. */
export type FromJsonCtor<T extends IDto> = {
  fromJson(
    json: unknown,
    opts?: { mode?: "wire" | "db"; validate?: boolean },
    _secret?: typeof DTO_SECRET
  ): T;
};

/** Interface exposed to generic callers (e.g., BagBuilder). */
export interface IServiceRegistry {
  instantiate<T extends IDto = IDto>(
    type: string,
    json: unknown,
    opts?: { mode?: "wire" | "db"; validate?: boolean }
  ): T;
}

export abstract class RegistryBase implements IServiceRegistry {
  /** Provide the shared secret to DTOs for guarded construction. */
  protected secret(): typeof DTO_SECRET {
    return DTO_SECRET;
  }

  /**
   * Typed helper to hydrate a DTO via its static fromJson.
   * - Defaults to mode:"wire", validate:true (safe at edges).
   * - Concrete registries should call this with the concrete DTO class.
   */
  protected build<T extends IDto>(
    ctor: FromJsonCtor<T>,
    json: unknown,
    opts?: { mode?: "wire" | "db"; validate?: boolean }
  ): T {
    return ctor.fromJson(
      json,
      { mode: "wire", validate: true, ...opts },
      this.secret()
    );
  }

  /** Concrete registries must override with a type-switch. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public instantiate<T extends IDto = IDto>(
    _type: string,
    _json: unknown,
    _opts?: { mode?: "wire" | "db"; validate?: boolean }
  ): T {
    throw new Error(
      "RegistryBase.instantiate not implemented. Dev: override in your service registry using a switch on 'type'."
    );
  }
}
