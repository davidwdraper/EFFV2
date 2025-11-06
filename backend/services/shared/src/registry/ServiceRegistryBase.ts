// backend/services/shared/src/registry/ServiceRegistryBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0053 (Bag Purity & Wire Envelope Separation)
 *
 * Purpose:
 * - Service-level Registry base that **extends** RegistryBase with:
 *    1) DTO hydrators (by type) for controllers/handlers,
 *    2) thin delegation to boot-time index building (no index logic here),
 *    3) simple diagnostics for registered DTOs.
 *
 * Invariants:
 * - No fallback types. Subclasses must provide the complete ctor map.
 * - Collections come from each DTO class's static dbCollectionName().
 * - Hydrators seed instance collection if missing (root-cause fix).
 * - Single concern: delegate index work to ensureIndexes module.
 */

import type { IDto } from "../dto/IDto";
import type { DtoCtor } from "./RegistryBase";
import { RegistryBase } from "./RegistryBase";

// Explicit relative paths (no @nv/shared alias within shared/)
import type { SvcEnvDto } from "../dto/svcenv.dto";
import type { ILogger } from "../logger/Logger";
import {
  ensureIndexesForDtos,
  type DtoCtorWithIndexes,
} from "../dto/persistence/indexes/ensureIndexes";

type Hydrator<T extends IDto = IDto> = (json: unknown) => T;

export abstract class ServiceRegistryBase extends RegistryBase {
  /**
   * Returns a DTO hydrator function for the given registry type key.
   * The hydrator:
   *  - constructs the DTO via <Ctor>.fromJson(json, { mode:'wire', validate })
   *  - ensures the instance's collection name is seeded once from the ctor's static
   */
  public hydratorFor<T extends IDto = IDto>(
    type: string,
    opts?: { validate?: boolean }
  ): Hydrator<T> {
    const ctor = this.resolveCtorByType(type) as DtoCtor<T>;
    const collection = this.dbCollectionNameByType(type);

    return (json: unknown): T => {
      const dto = ctor.fromJson(json, {
        mode: "wire",
        validate: opts?.validate === true,
      });

      // Seed instance-level collection if absent.
      const have = (dto as any).getCollectionName?.();
      if (!have) {
        if (typeof (dto as any).setCollectionName !== "function") {
          throw new Error(
            `REGISTRY_INSTANCE_NO_SETTER: DTO for "${type}" missing setCollectionName().`
          );
        }
        (dto as any).setCollectionName(collection);
      }

      return dto;
    };
  }

  /**
   * Delegate: collect registered DTO CLASSES that declare indexHints and
   * pass them to the shared ensureIndexes routine. No index logic lives here.
   */
  public async ensureIndexes(svcEnv: SvcEnvDto, log: ILogger): Promise<void> {
    const map = this.ctorByType();

    const dtos: DtoCtorWithIndexes[] = [];
    for (const type of Object.keys(map)) {
      const ctor = this.resolveCtorByType(type) as any;
      const hasHints =
        Array.isArray(ctor?.indexHints) &&
        typeof ctor?.dbCollectionName === "function";
      if (hasHints) {
        dtos.push(ctor as DtoCtorWithIndexes);
      } else {
        log?.debug?.(
          { type, hasIndexHints: Array.isArray(ctor?.indexHints) },
          "registry.ensureIndexes: no indexHints on DTO — skipping"
        );
      }
    }

    await ensureIndexesForDtos({ dtos, svcEnv, log });
  }

  /**
   * Simple diagnostic listing of registered keys and their collections.
   */
  public listRegistered(): Array<{ type: string; collection: string }> {
    const map = this.ctorByType();
    return Object.keys(map).map((type) => ({
      type,
      collection: this.dbCollectionNameByType(type),
    }));
  }
}
