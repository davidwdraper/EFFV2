// backend/services/shared/src/registry/ServiceRegistryBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0102 (Registry sole DTO creation authority)
 *   - ADR-0103 (DTO naming convention: keys)
 *
 * Status:
 * - This file is intentionally minimal.
 *
 * Purpose:
 * - If anything still imports ServiceRegistryBase, it must NOT drag in dead
 *   legacy bases (RegistryBase, resolveCtorByType, dbCollectionNameByType).
 *
 * Invariant:
 * - Hydration is registry-only: registry.create(dtoKey, body, { validate, mode }).
 */

import type { DtoBase } from "../dto/DtoBase";
import type { IDtoRegistry } from "./IDtoRegistry";

type Hydrator<T extends DtoBase = DtoBase> = (json: unknown) => T;

export abstract class ServiceRegistryBase {
  protected abstract getRegistry(): IDtoRegistry;

  public hydratorFor<T extends DtoBase = DtoBase>(
    dtoKey: string,
    opts?: { validate?: boolean; mode?: "wire" | "db" }
  ): Hydrator<T> {
    const reg = this.getRegistry();
    const validate = opts?.validate === true;
    const mode = opts?.mode;

    return (json: unknown) => {
      return reg.create<T>(dtoKey, json, { validate, mode });
    };
  }
}
