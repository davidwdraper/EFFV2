// backend/services/t_entity_crud/src/registry/Registry.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & Wire Discrimination; DTO-only validation)
 *   - ADR-0045 (Index Hints — boot ensure owned by Registry)
 *   - ADR-0056 (DELETE path uses <DtoTypeKey> for deterministic collection)
 *
 * Purpose:
 * - Service-specific DTO registry for the t_entity_crud template.
 * - Single source of truth for:
 *   • Hydration (instantiate/build)
 *   • Boot-time index ensure for all DTOs in this service
 *   • Public collection-name resolution by DTO type key
 *
 * Cloner note:
 * - Each DTO provides its own static dbCollectionName() next to indexHints.
 */

import { RegistryBase, IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import type { IDto } from "@nv/shared/dto/IDto";

import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import type { ILogger } from "@nv/shared/logger/Logger";
import {
  ensureIndexesForDtos,
  type DtoCtorWithIndexes,
} from "@nv/shared/dto/persistence/indexes/ensureIndexes";

// Template DTO — replaced by cloner in real services.
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";

type BuildOpts = { mode?: "wire" | "db"; validate?: boolean };

export class Registry extends RegistryBase implements IDtoRegistry {
  /** Helper to seed collection name exactly once on a new DTO instance. */
  private _seed<T extends IDto>(
    dto: T,
    ctor: { dbCollectionName: () => string }
  ): T {
    const anyDto = dto as unknown as {
      setCollectionName?: (n: string) => unknown;
    };
    if (typeof anyDto?.setCollectionName === "function") {
      anyDto.setCollectionName(ctor.dbCollectionName());
    }
    return dto;
  }

  /** Explicit constructor for XxxDto (compile-time obvious, easy to extend). */
  public newXxx(json: unknown, opts?: BuildOpts): XxxDto {
    const dto = this.build<XxxDto>(XxxDto, json, opts);
    return this._seed(dto, XxxDto);
  }

  // ---------- Typed overloads to avoid generic cast warnings ----------
  public instantiate(type: "xxx", json: unknown, opts?: BuildOpts): XxxDto;
  public instantiate<T extends IDto = IDto>(
    type: string,
    json: unknown,
    opts?: BuildOpts
  ): T;

  // Implementation: returns IDto; overloads give precise types to callers.
  public instantiate(type: string, json: unknown, opts?: BuildOpts): IDto {
    switch (type) {
      case "xxx":
        return this.newXxx(json, opts);

      // Example for future additions:
      // case "my-special":
      //   return this.newMySpecial(json, opts);

      default:
        throw new Error(
          `Unknown DTO type "${type}" in ${this.constructor.name}. ` +
            `Dev: add a factory, overload, switch case, and list it in allDtos().`
        );
    }
  }

  /**
   * Public: resolve the DB collection name for a DTO type key.
   * - No DTO instantiation or I/O; pure switch over known DTO classes.
   */
  public dbCollectionNameByType(type: string): string {
    switch (type) {
      case "xxx":
      case "XxxDto": // allow the class-ish key too, if your clients prefer it
        return XxxDto.dbCollectionName();

      // Add future DTOs here, e.g.:
      // case "env-service-values":
      // case "EnvServiceDto":
      //   return EnvServiceDto.dbCollectionName();

      default:
        throw new Error(
          `UNKNOWN_DTO_TYPE: No collection mapping for "${type}". ` +
            `Ops: client must use a registered DTO type key; Dev: add to Registry.dbCollectionNameByType().`
        );
    }
  }

  /**
   * Single source of truth for DTO classes in this service.
   * Append new DTO CLASSES here when you add them to the registry.
   */
  protected allDtos(): DtoCtorWithIndexes[] {
    return [XxxDto];
  }

  /**
   * Boot-time index ensure for all DTOs in this registry.
   * Uses each DTO's own class-level dbCollectionName().
   */
  public async ensureIndexes(opts: {
    svcEnv: SvcEnvDto; // URI/DB only
    log: ILogger;
  }): Promise<void> {
    // Validate DTOs expose a collection name (fail fast if any don't).
    for (const ctor of this.allDtos() as Array<
      DtoCtorWithIndexes & { dbCollectionName?: () => string; name?: string }
    >) {
      if (typeof ctor.dbCollectionName !== "function") {
        throw new Error(
          `INDEX_ENSURE_NO_COLLECTION: DTO ${
            ctor.name ?? "<anon>"
          } missing static dbCollectionName(). Dev: define it next to indexHints.`
        );
      }
      const n = ctor.dbCollectionName();
      if (!n?.trim()) {
        throw new Error(
          `INDEX_ENSURE_EMPTY_COLLECTION: DTO ${
            ctor.name ?? "<anon>"
          } returned empty dbCollectionName(). Dev: hard-wire a non-empty string.`
        );
      }
    }

    await ensureIndexesForDtos({
      dtos: this.allDtos(),
      svcEnv: opts.svcEnv,
      log: opts.log,
    });
  }
}
