// backend/services/shared/src/registry/RegistryBase.ts
/**
 * Docs:
 * - SOP: Keep shared contracts tight; deterministic; no fallbacks
 * - ADRs:
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *   - ADR-0103 (DTO naming convention: keys, filenames, classnames)
 *   - ADR-0088/0091 (DTO test-data sidecars)
 *
 * Purpose:
 * - Shared DTO Registry base + helpers (test-data minting, sidecar-driven variants).
 *
 * NOTE:
 * - The global DTO registry is DtoRegistry (shared/src/registry/DtoRegistry.ts).
 * - RegistryBase remains useful for test-data minting patterns; it also exposes
 *   the registry instantiation secret for legacy DTOs until full ctor-injection lands.
 */

import type { IDto } from "../../../packages/dto/core/IDto";
import { newUuid } from "../../../packages/dto/core/utils/uuid";
import {
  shapeFromHappyString,
  uniqueValueBuilder,
} from "../../../packages/dto/core/utils/testdata/uniqueValueBuilder";

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
  type: string;
  item?: unknown;
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
  getHints?: () => unknown;
};

type FieldHint = { unique?: boolean } & Record<string, unknown>;
type FieldHints = { fields?: Record<string, FieldHint> };

function asFieldHints(v: unknown): FieldHints {
  if (!v || typeof v !== "object") return {};
  return v as FieldHints;
}

function cloneJsonObject<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export abstract class RegistryBase implements IDtoRegistry {
  // ───────────────────────────────────────────
  // Instantiation secret (owned by registry, not DTOs)
  // ───────────────────────────────────────────

  private static readonly INSTANTIATION_SECRET = Symbol(
    "NvDtoRegistryInstantiationSecret"
  );

  public static getInstantiationSecret(): symbol {
    return RegistryBase.INSTANTIATION_SECRET;
  }

  /** Subclasses MUST return the ctor map. No properties, no shims. */
  protected abstract ctorByType(): Record<string, DtoCtor<IDto>>;

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

    const json =
      (item as any).item !== undefined ? (item as any).item : (item as unknown);

    const dto = ctor.fromBody(json, {
      mode: "wire",
      validate: opts?.validate === true,
    });

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
        `REGISTRY_TESTDATA_MISSING: no tdata provider registered for type "${type}".`
      );
    }

    const happyJsonRaw = tdata.getJson();
    const happyJson = cloneJsonObject(happyJsonRaw);

    const hints =
      typeof tdata.getHints === "function"
        ? asFieldHints(tdata.getHints())
        : {};

    // ADR-0102: wire hydration requires _id to exist (UUIDv4) in the edge payload.
    // Test-data minting is an edge-hydration path, so ensure _id exists here.
    this.ensureWireId(type, happyJson);

    // Sidecar-driven uniqueness for non-id fields (email, phone, etc).
    // IMPORTANT: _id MUST NOT be shape-uniquified (uuidv4 constraints).
    this.applyUniqueHints(type, happyJson, hints);

    const ctor = this.resolveCtorByType(type);
    const dto = ctor.fromBody(happyJson, { mode: "wire", validate: true });

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

  private ensureWireId(type: string, targetJson: unknown): void {
    if (!isPlainObject(targetJson)) {
      throw new Error(
        `REGISTRY_TESTDATA_BAD_JSON: tdata.getJson() for "${type}" must return an object.`
      );
    }

    const obj = targetJson as Record<string, unknown>;

    // Only seed if missing. If present, DTO validation remains the source of truth.
    if (obj["_id"] === undefined) {
      obj["_id"] = newUuid();
      return;
    }
  }

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

      // ADR-0102: _id is a uuidv4; never attempt shape-based mutation.
      if (k === "_id") continue;

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
