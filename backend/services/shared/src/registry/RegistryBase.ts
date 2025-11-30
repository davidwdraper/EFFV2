// backend/services/shared/src/registry/RegistryBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0053 (Bag Purity & Wire Envelope Separation)
 *
 * Purpose:
 * - Shared DTO Registry base + helpers.
 * - Guarantees DTO instances created through the registry have their instance-level
 *   collection name set from the DTO class's dbCollectionName() (root-cause fix).
 *
 * Invariants:
 * - No fallbacks, no legacy modes. One canonical contract:
 *     protected ctorByType(): Record<string, DtoCtor<IDto>>;
 */

import type { IDto } from "../dto/IDto";

/** Minimal structural type a DTO ctor must satisfy. */
export type DtoCtor<T extends IDto = IDto> = {
  fromBody(
    json: unknown,
    opts?: { mode?: "wire" | "db"; validate?: boolean }
  ): T;
  dbCollectionName(): string;
};

/** Minimal wire item shape (ADR-0050). */
export type BagItemWire = {
  type: string; // Registry type key, e.g., "xxx"
  item?: unknown; // DTO JSON payload (optional if callers pass the DTO JSON directly)
};

export interface IDtoRegistry {
  getCtorByType(type: string): DtoCtor<IDto> | undefined;
  resolveCtorByType(type: string): DtoCtor<IDto>;
  dbCollectionNameByType(type: string): string;
  fromWireItem(item: BagItemWire, opts?: { validate?: boolean }): IDto;
}

export abstract class RegistryBase implements IDtoRegistry {
  /** Subclasses MUST return the ctor map. No properties, no shims. */
  protected abstract ctorByType(): Record<string, DtoCtor<IDto>>;

  public getCtorByType(type: string): DtoCtor<IDto> | undefined {
    const map = this.ctorByType();
    return map[type];
  }

  public resolveCtorByType(type: string): DtoCtor<IDto> {
    const ctor = this.getCtorByType(type);
    if (!ctor || typeof ctor.fromBody !== "function") {
      throw new Error(
        `REGISTRY_UNKNOWN_TYPE: no ctor registered for type "${type}".`
      );
    }
    return ctor;
  }

  public dbCollectionNameByType(type: string): string {
    const ctor = this.resolveCtorByType(type);
    const fn = (ctor as any).dbCollectionName;
    if (typeof fn !== "function") {
      throw new Error(
        `REGISTRY_CTOR_NO_COLLECTION_FN: registered ctor for "${type}" missing static dbCollectionName().`
      );
    }
    const coll = fn.call(ctor);
    if (typeof coll !== "string" || !coll.trim()) {
      throw new Error(
        `REGISTRY_EMPTY_COLLECTION: ctor for "${type}" returned empty collection name.`
      );
    }
    return coll;
  }

  public fromWireItem(item: BagItemWire, opts?: { validate?: boolean }): IDto {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as any).type !== "string"
    ) {
      throw new Error("REGISTRY_BAD_WIRE_ITEM: missing 'type' on wire item.");
    }

    const typeKey = (item as any).type as string;
    const ctor = this.resolveCtorByType(typeKey);

    // Accept either BagItemWire or raw DTO JSON; prefer item.item if present.
    const json =
      (item as any).item !== undefined ? (item as any).item : (item as unknown);

    const dto = ctor.fromBody(json, {
      mode: "wire",
      validate: opts?.validate === true,
    });

    // Ensure instance has its collection set (once) from the ctor’s static.
    const have = (dto as any).getCollectionName?.();
    if (!have) {
      const coll = this.dbCollectionNameByType(typeKey);
      if (typeof (dto as any).setCollectionName !== "function") {
        throw new Error(
          `REGISTRY_INSTANCE_NO_SETTER: DTO for "${typeKey}" missing setCollectionName().`
        );
      }
      (dto as any).setCollectionName(coll);
    }

    return dto;
  }
}
