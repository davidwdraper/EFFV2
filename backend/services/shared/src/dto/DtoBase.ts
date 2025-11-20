// backend/services/shared/src/dto/DtoBase.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 *   - ADR-0053 (Instantiation discipline via BaseDto secret)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable; WARN on overwrite attempt)
 *   - ADR-0060 (DTO Secure Access Layer)
 *
 * Purpose:
 * - Base class for all DTOs.
 * - Owns:
 *   • Instantiation secret (prevents ad-hoc `new Dto()` in random code).
 *   • Canonical `_id` lifecycle (UUIDv4, set-once).
 *   • Meta fields (createdAt / updatedAt / updatedByUserId).
 *   • Collection name plumbing (dbCollectionName → instance).
 *   • Finalization hook for outbound wire JSON.
 *   • Optional per-field access rules for secure getters/setters.
 */

import { randomUUID } from "crypto";
import type { IDto } from "./IDto";

/**
 * UserType enum used for DTO access control.
 * The numeric ordinals are ordered from least to most privileged.
 */
export const enum UserType {
  Anon = 0,
  Viber = 1,
  PremViber = 2,
  NotUsedYet = 3,
  AdminDomain = 4,
  AdminSystem = 5,
  AdminRoot = 6,
}

export type DtoMeta = {
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

type AccessRule = {
  read: UserType;
  write: UserType;
};

type AccessMap = Record<string, AccessRule>;

export abstract class DtoBase {
  // ─────────────── Instantiation Secret ───────────────

  private static readonly INSTANTIATION_SECRET = Symbol(
    "DtoBaseInstantiationSecret"
  );

  public static getSecret(): symbol {
    return DtoBase.INSTANTIATION_SECRET;
  }

  // ─────────────── Identity & Meta ───────────────

  /** Canonical wire id; UUIDv4, immutable once set. */
  protected _id?: string;

  protected _createdAt?: string;
  protected _updatedAt?: string;
  protected _updatedByUserId?: string;

  // ─────────────── Collection Name ───────────────

  /** Backing field for the Mongo collection name this DTO instance belongs to. */
  protected _collectionName?: string;

  // ─────────────── Access Control Context ───────────────

  /**
   * Current user type for this DTO instance.
   * Set once per request lifecycle by the caller (Registry/pipeline).
   */
  protected _currentUserType: UserType = UserType.Anon;

  protected constructor(secretOrMeta?: symbol | DtoMeta) {
    if (
      secretOrMeta === DtoBase.INSTANTIATION_SECRET ||
      secretOrMeta === undefined
    ) {
      // Fresh instance; meta/collection will be set explicitly later.
      return;
    }

    if (typeof secretOrMeta === "object" && secretOrMeta !== null) {
      this.setMeta(secretOrMeta);
      return;
    }

    throw new Error(
      "DTO_INSTANTIATION_DENIED: DtoBase constructed without valid secret or meta."
    );
  }

  // ─────────────── ID Lifecycle (matches IDto semantics) ───────────────

  public setIdOnce(id: string): void {
    const trimmed = (id ?? "").trim();
    if (!trimmed) {
      throw new Error("DTO_ID_INVALID: `_id` must be a non-empty string.");
    }

    if (this._id && this._id !== trimmed.toLowerCase()) {
      throw new Error(
        `DTO_ID_IMMUTABLE: Attempt to overwrite existing _id '${this._id}' with '${trimmed}'.`
      );
    }

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        trimmed
      )
    ) {
      throw new Error(
        `DTO_ID_INVALID_SHAPE: Expected UUIDv4 string, got '${trimmed}'.`
      );
    }

    this._id = trimmed.toLowerCase();
  }

  /**
   * Generate and set a UUIDv4 `_id` if none exists yet.
   * Used by DbWriter BEFORE calling toJson().
   */
  public ensureId(): void {
    if (!this._id) {
      const id = randomUUID();
      this.setIdOnce(id);
    }
  }

  /**
   * Return the current `_id`.
   * If no id is present, this is a programming error at the call site.
   * Callers that want to probe must use hasId() first.
   */
  public getId(): string {
    if (!this._id) {
      throw new Error(
        "DTO_ID_MISSING: getId() called on DTO instance without an assigned `_id`. " +
          "Call hasId()/ensureId() first or fix the call site."
      );
    }
    return this._id;
  }

  /** Whether this DTO currently has an `_id`. */
  public hasId(): boolean {
    return !!this._id;
  }

  // ─────────────── Collection Name ───────────────

  public getCollectionName(): string | undefined {
    return this._collectionName;
  }

  public setCollectionName(name: string): void {
    const trimmed = (name ?? "").trim();
    if (!trimmed) {
      throw new Error(
        "DTO_COLLECTION_INVALID: collection name must be a non-empty string."
      );
    }
    this._collectionName = trimmed;
  }

  // ─────────────── Meta Handling ───────────────

  protected setMeta(meta?: DtoMeta): void {
    if (!meta) return;
    this._createdAt = meta.createdAt ?? this._createdAt;
    this._updatedAt = meta.updatedAt ?? this._updatedAt;
    this._updatedByUserId = meta.updatedByUserId ?? this._updatedByUserId;
  }

  protected _finalizeToJson<TBody extends object>(
    body: TBody
  ): TBody & DtoMeta {
    return {
      ...(body as object),
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      updatedByUserId: this._updatedByUserId,
    } as TBody & DtoMeta;
  }

  // ─────────────── Access Context Wiring ───────────────

  public setCurrentUserType(userType: UserType): void {
    this._currentUserType = userType;
  }

  public getCurrentUserType(): UserType {
    return this._currentUserType;
  }

  // ─────────────── Secure Field Access Helpers ───────────────

  private _getAccessMap(): AccessMap {
    const ctor = this.constructor as unknown as {
      access?: AccessMap;
      name?: string;
    };
    if (!ctor.access) {
      throw new Error(
        `DTO_ACCESS_MAP_MISSING: 'access' map is not defined on DTO '${
          ctor.name ?? "<anonymous>"
        }'.`
      );
    }
    return ctor.access;
  }

  protected readField<T = unknown>(fieldName: string): T {
    const accessMap = this._getAccessMap();
    const rule = accessMap[fieldName];
    const dtoName =
      (this.constructor as { name?: string }).name ?? "<anonymous>";

    if (!rule) {
      throw new Error(
        `DTO_ACCESS_RULE_MISSING: No access rule defined for field '${fieldName}' on DTO '${dtoName}'.`
      );
    }

    if (this._currentUserType < rule.read) {
      throw new Error(
        `DTO_ACCESS_DENIED_READ: UserType ${this._currentUserType} cannot read field '${fieldName}' on DTO '${dtoName}'.`
      );
    }

    return (this as any)[`_${fieldName}`] as T;
  }

  protected writeField<T = unknown>(fieldName: string, value: T): void {
    const accessMap = this._getAccessMap();
    const rule = accessMap[fieldName];
    const dtoName =
      (this.constructor as { name?: string }).name ?? "<anonymous>";

    if (!rule) {
      throw new Error(
        `DTO_ACCESS_RULE_MISSING: No access rule defined for field '${fieldName}' on DTO '${dtoName}'.`
      );
    }

    if (this._currentUserType < rule.write) {
      throw new Error(
        `DTO_ACCESS_DENIED_WRITE: UserType ${this._currentUserType} cannot write field '${fieldName}' on DTO '${dtoName}'.`
      );
    }

    (this as any)[`_${fieldName}`] = value;
  }

  // ─────────────── Cloning (aligned with IDto.clone(newId?: string): this) ───────────────

  /**
   * Shallow clone this DTO.
   *
   * - If newId is omitted, the clone retains the same `_id`.
   * - If newId is provided, the clone receives that id without violating the
   *   "id is immutable" rule (we explicitly clear `_id` before setting).
   */
  public clone(newId?: string): this {
    const ctor = this.constructor as { new (...args: any[]): any };
    const copy = new ctor(DtoBase.getSecret()) as this;

    // Copy all own properties, including _id/meta/collectionName/etc.
    Object.assign(copy, this);

    if (newId !== undefined) {
      (copy as any)._id = undefined;
      copy.setIdOnce(newId);
    }

    return copy;
  }

  // ─────────────── Abstracts / Expectations ───────────────

  /**
   * Concrete DTOs must provide a stable type identifier and a concrete toJson().
   * IDto is satisfied structurally by subclasses that implement:
   *  - getType(): string
   *  - toJson(): unknown
   */
  public abstract getType(): string;
}
