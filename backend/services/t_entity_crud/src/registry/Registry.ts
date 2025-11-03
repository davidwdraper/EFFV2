// backend/services/t_entity_crud/src/registry/Registry.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & Wire Discrimination; DTO-only validation)
 *   - ADR-0045 (Index Hints — boot ensure owned by Registry)
 *
 * Purpose:
 * - Service-specific DTO registry for the t_entity_crud template.
 * - Single source of truth for:
 *   • Hydration (instantiate/build)
 *   • Boot-time index ensure for all DTOs in this service
 *
 * How to add another DTO after cloning:
 *   1) import { MySpecialDto } from "@nv/shared/dto/xxx/my-special.dto";
 *   2) add: public newMySpecial(json, opts) { return this.build(MySpecialDto, json, opts); }
 *   3) add an overload: public instantiate(type: "my-special", json: unknown, opts?): MySpecialDto;
 *   4) extend the switch to call this.newMySpecial(json, opts);
 *   5) append the CLASS to allDtos(): return [XxxDto, MySpecialDto];
 */

import {
  RegistryBase,
  IServiceRegistry,
} from "@nv/shared/registry/RegistryBase";
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

export class Registry extends RegistryBase implements IServiceRegistry {
  /** Explicit constructor for XxxDto (compile-time obvious, easy to extend). */
  public newXxx(json: unknown, opts?: BuildOpts): XxxDto {
    return this.build<XxxDto>(XxxDto, json, opts);
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
   * Single source of truth for DTO classes in this service.
   * Append new DTO CLASSES here when you add them to the registry.
   */
  protected allDtos(): DtoCtorWithIndexes[] {
    return [XxxDto];
  }

  /**
   * Boot-time index ensure for all DTOs in this registry.
   * Keeps App.ts free of concrete DTO imports and prevents drift.
   */
  public async ensureIndexes(opts: {
    svcEnv: SvcEnvDto;
    log: ILogger;
  }): Promise<void> {
    await ensureIndexesForDtos({
      dtos: this.allDtos(),
      svcEnv: opts.svcEnv,
      log: opts.log,
    });
  }
}
