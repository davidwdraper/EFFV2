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
 */

import type { IDto } from "../dto/IDto";

/** Minimal structural type a DTO ctor must satisfy. */
export type DtoCtor<T extends IDto = IDto> = {
  fromJson(
    json: unknown,
    opts?: { mode?: "wire" | "db"; validate?: boolean }
  ): T;
  dbCollectionName(): string;
};

/** Minimal wire item shape (ADR-0050). */
export type BagItemWire = {
  type: string; // Registry type key, e.g., "xxx"
  item?: unknown; // DTO JSON payload (optional if callers pass the whole BagItemWire)
};

export interface IDtoRegistry {
  getCtorByType(type: string): DtoCtor<IDto> | undefined;
  resolveCtorByType(type: string): DtoCtor<IDto>;
  dbCollectionNameByType(type: string): string;
  fromWireItem(item: BagItemWire, opts?: { validate?: boolean }): IDto;
}

export abstract class RegistryBase implements IDtoRegistry {
  /** Override to provide the map from type key → DTO ctor. */
  protected abstract ctorByType(): Record<string, DtoCtor<IDto>>;

  public getCtorByType(type: string): DtoCtor<IDto> | undefined {
    return this.ctorByType()[type];
  }

  public resolveCtorByType(type: string): DtoCtor<IDto> {
    const ctor = this.getCtorByType(type);
    if (!ctor || typeof ctor.fromJson !== "function") {
      throw new Error(
        `REGISTRY_UNKNOWN_TYPE: no ctor registered for type "${type}".`
      );
    }
    return ctor;
  }

  public dbCollectionNameByType(type: string): string {
    const ctor = this.resolveCtorByType(type);

    // Safely derive a display name without requiring it in the type
    const typeName = (ctor as any)?.name ?? "<anon>";

    const fn = (ctor as any).dbCollectionName;
    if (typeof fn !== "function") {
      throw new Error(
        `REGISTRY_CTOR_NO_COLLECTION_FN: ${typeName} missing static dbCollectionName().`
      );
    }
    const coll = fn.call(ctor);
    if (!coll || typeof coll !== "string" || !coll.trim()) {
      throw new Error(
        `REGISTRY_EMPTY_COLLECTION: ${typeName} returned empty collection name.`
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
    const typeName = (ctor as any)?.name ?? "<anon>";

    // Accept either the full BagItemWire or just the DTO JSON; prefer item.item if present.
    const json =
      (item as any).item !== undefined ? (item as any).item : (item as unknown);

    const dto = ctor.fromJson(json, {
      mode: "wire",
      validate: opts?.validate === true,
    });

    // Ensure instance has its collection set (once) from the ctor’s static
    const have = (dto as any).getCollectionName?.();
    if (!have) {
      const coll = this.dbCollectionNameByType(typeKey);
      if (
        !(dto as any).setCollectionName ||
        typeof (dto as any).setCollectionName !== "function"
      ) {
        throw new Error(
          `REGISTRY_INSTANCE_NO_SETTER: ${typeName} instance missing setCollectionName().`
        );
      }
      (dto as any).setCollectionName(coll);
    }

    return dto;
  }
}
