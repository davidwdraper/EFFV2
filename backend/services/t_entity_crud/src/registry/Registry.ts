// backend/services/t_entity_crud/src/registry/Registry.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *
 * Purpose:
 * - Centralized DTO instantiation and wiring for this service.
 * - Each service maintains exactly one Registry.
 * - Registry enforces that DTOs are created through it, not directly.
 *
 * Notes:
 * - Keeps to KISS: no dynamic maps, no type reflection.
 * - After cloning, simply add any new DTO types here.
 */

import { BaseDto } from "@nv/shared/dto/DtoBase";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";

export class Registry {
  /** Shared secret passed into DTO constructors */
  private readonly secret = BaseDto.getSecret();

  // ─────────────── Primary DTO (template default) ───────────────
  /** Create a new XxxDto instance with a seeded collection. */
  public newXxxDto(): XxxDto {
    const dto = new XxxDto(this.secret);
    dto.setCollectionName(XxxDto.dbCollectionName());
    return dto;
  }

  /** Hydrate an XxxDto from JSON (bypasses constructor enforcement). */
  public fromJsonXxx(json: unknown, opts?: { validate?: boolean }): XxxDto {
    const dto = XxxDto.fromJson(json, opts);
    dto.setCollectionName(XxxDto.dbCollectionName());
    return dto;
  }

  public hydratorFor(dtoType: string, opts?: { validate?: boolean }) {
    switch (dtoType) {
      case "xxx":
        return (j: unknown) =>
          this.fromJsonXxx(j, { validate: !!opts?.validate });
      // case "another":
      //   return (j: unknown) => this.fromJsonAnother(j, { validate: !!opts?.validate });
      default:
        throw new Error(`Unknown dtoType "${dtoType}"`);
    }
  }

  // ─────────────── Future DTOs (example placeholder) ───────────────
  // Uncomment and adapt when adding new DTO types.
  //
  // import { MyNewDto } from "@nv/shared/dto/templates/my-new/my-new.dto";
  //
  // public newMyNewDto(): MyNewDto {
  //   const dto = new MyNewDto(this.secret);
  //   dto.setCollectionName(MyNewDto.dbCollectionName());
  //   return dto;
  // }
  //
  // public fromJsonMyNew(json: unknown, opts?: { validate?: boolean }): MyNewDto {
  //   const dto = MyNewDto.fromJson(json, opts);
  //   dto.setCollectionName(MyNewDto.dbCollectionName());
  //   return dto;
  // }

  // ─────────────── Diagnostic Helpers ───────────────
  public listRegistered(): string[] {
    return ["XxxDto" /*, "MyNewDto" */];
  }
}
