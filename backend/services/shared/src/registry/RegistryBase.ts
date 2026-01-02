// backend/services/shared/src/registry/RegistryBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0053 (Bag Purity & Wire Envelope Separation)
 *   - ADR-0088 (DTO Test Data Sidecars)
 *   - ADR-0091 (DTO Sidecar Tooling + Testdata Output)
 *
 * Purpose:
 * - Shared DTO Registry base + helpers.
 * - Guarantees DTO instances created through the registry have their instance-level
 *   collection name set from the DTO class's dbCollectionName() (root-cause fix).
 * - Provides canonical "happy" test DTO minting via DTO test-data sidecars.
 *
 * Invariants:
 * - No fallbacks, no legacy modes. One canonical contract:
 *     protected ctorByType(): Record<string, DtoCtor<IDto>>;
 * - Sidecar is happy-only. Registry owns test variants.
 * - Test-time uniqueness is applied INSIDE the registry (magic box), not by callers.
 */

import type { IDto } from "../dto/IDto";
import {
  shapeFromHappyString,
  uniqueValueBuilder,
} from "../utils/testdata/uniqueValueBuilder";

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

/** Test DTO types supported by the test-runner (variants minted by Registry). */
export type TestDtoType = "happy" | "duplicate" | "missing" | "badData";

/** Minimal structural shape a generated DTO test-data sidecar must satisfy. */
export type DtoTdataProvider = {
  getJson(): unknown;

  /**
   * Optional hints (generated alongside happy JSON).
   * Shape is tool-owned, but RegistryBase treats it as a loose contract:
   *   { fields: { [fieldName]: { unique?: boolean, ... } } }
   */
  getHints?: () => unknown;
};

type FieldHint = { unique?: boolean } & Record<string, unknown>;
type FieldHints = { fields?: Record<string, FieldHint> };

function asFieldHints(v: unknown): FieldHints {
  if (!v || typeof v !== "object") return {};
  return v as FieldHints;
}

function cloneJsonObject<T>(v: T): T {
  // happy JSON is small, deterministic, and data-only; JSON clone is fine here.
  return JSON.parse(JSON.stringify(v)) as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export abstract class RegistryBase implements IDtoRegistry {
  /** Subclasses MUST return the ctor map. No properties, no shims. */
  protected abstract ctorByType(): Record<string, DtoCtor<IDto>>;

  /**
   * Subclasses MAY provide a map of DTO type keys → happy-only tdata providers.
   * - Sidecars are generated and happy-only by design.
   * - Registry is responsible for minting test variants from the happy JSON.
   *
   * Default is empty: registries without sidecars simply cannot mint test DTOs.
   */
  protected tdataByType(): Record<string, DtoTdataProvider> {
    return {};
  }

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

  // ─────────────── Test DTO Minting ───────────────

  public getTestDto(testType: TestDtoType = "happy"): IDto {
    const keys = Object.keys(this.ctorByType());
    if (keys.length !== 1) {
      throw new Error(
        `REGISTRY_TESTDTO_AMBIGUOUS: getTestDto() requires a single-type registry, but found ${keys.length} types. ` +
          `Ops: call getTestDtoByType(type, testType) instead.`
      );
    }
    return this.getTestDtoByType(keys[0], testType);
  }

  /**
   * Mint a test DTO for an explicit type key.
   *
   * Current scope:
   * - "happy": hydrates from happy-only sidecar JSON, then applies test-time
   *   uniqueness to fields marked unique:true in sidecar hints (if present).
   *
   * IMPORTANT:
   * - This keeps uniquify inside the registry (no external mutation steps).
   * - No seed passed around; uniqueness is magic-box (guid+hash) per field.
   */
  public getTestDtoByType(type: string, testType: TestDtoType = "happy"): IDto {
    if (testType !== "happy") {
      throw new Error(
        `REGISTRY_TESTDTO_UNSUPPORTED: testType "${testType}" not implemented yet. ` +
          `Ops: use "happy" for now.`
      );
    }

    const tdata = this.tdataByType()[type];
    if (!tdata || typeof tdata.getJson !== "function") {
      throw new Error(
        `REGISTRY_TESTDATA_MISSING: no tdata provider registered for type "${type}". ` +
          `Ops: implement tdataByType() in this registry and map "${type}" to its <Dto>Tdata.getJson().`
      );
    }

    // Start from the tool-generated happy JSON (data-only).
    const happyJsonRaw = tdata.getJson();

    // Clone so we never mutate the generated sidecar object graph.
    const happyJson = cloneJsonObject(happyJsonRaw);

    // Apply uniqueness (if hints exist). This is the only "mutation" in v1,
    // and it is purely to avoid DB uniqueness collisions during tests.
    const hints =
      typeof tdata.getHints === "function"
        ? asFieldHints(tdata.getHints())
        : {};
    this.applyUniqueHints(type, happyJson, hints);

    const ctor = this.resolveCtorByType(type);
    const dto = ctor.fromBody(happyJson, { mode: "wire", validate: true });

    // Mirror fromWireItem() invariant: ensure instance collection is set.
    const have = (dto as any).getCollectionName?.();
    if (!have) {
      const coll = this.dbCollectionNameByType(type);
      if (typeof (dto as any).setCollectionName !== "function") {
        throw new Error(
          `REGISTRY_INSTANCE_NO_SETTER: DTO for "${type}" missing setCollectionName().`
        );
      }
      (dto as any).setCollectionName(coll);
    }

    return dto;
  }

  /**
   * Apply test-time uniqueness to fields marked unique:true.
   *
   * v1 scope:
   * - top-level fields only
   * - string only
   *
   * Contract:
   * - If a unique field is ABSENT from happyJson, do nothing (optional + not present-by-default is allowed).
   * - If a unique field is PRESENT but not a non-empty string, fail fast (sidecar/tool drift).
   */
  private applyUniqueHints(
    type: string,
    targetJson: unknown,
    hints: FieldHints
  ): void {
    if (!isPlainObject(targetJson)) {
      throw new Error(
        `REGISTRY_TESTDATA_BAD_JSON: tdata.getJson() for "${type}" must return an object.`
      );
    }
    const obj = targetJson as Record<string, unknown>;

    const fields = hints.fields ?? {};
    const keys = Object.keys(fields);

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const hint = fields[k];
      if (!hint || hint.unique !== true) continue;

      // If the unique field isn't present in happy JSON, leave it absent.
      if (!(k in obj)) continue;

      const cur = obj[k];
      if (typeof cur !== "string" || !cur) {
        throw new Error(
          `REGISTRY_TESTDATA_UNIQUE_BAD_VALUE: "${type}" unique field "${k}" must be a non-empty string exemplar.`
        );
      }

      const shape = shapeFromHappyString(cur);
      const next = uniqueValueBuilder(shape);

      if (typeof next !== "string" || !next) {
        throw new Error(
          `REGISTRY_TESTDATA_UNIQUE_EMPTY: uniqueValueBuilder() returned empty value for "${type}.${k}".`
        );
      }

      obj[k] = next;
    }
  }
}
