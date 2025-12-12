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
 *   • Meta fields (createdAt / updatedAt / updatedByUserId / ownerUserId).
 *   • Collection name plumbing (dbCollectionName → instance).
 *   • Finalization hook for outbound wire JSON.
 *   • Optional per-field access rules for secure getters/setters.
 */

import { newUuid, validateUUIDv4String } from "../utils/uuid";

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
  ownerUserId?: string;
};

type AccessRule = {
  read: UserType;
  write: UserType;
};

type AccessMap = Record<string, AccessRule>;

/**
 * Validation error used by concrete DTOs when they perform
 * per-DTO validation (e.g., EnvServiceDto.fromBody with validate=true).
 */
export class DtoValidationError extends Error {
  public readonly issues: Array<{
    path: string;
    code: string;
    message: string;
  }>;

  constructor(
    message: string,
    issues: Array<{ path: string; code: string; message: string }>
  ) {
    super(message);
    this.name = "DtoValidationError";
    this.issues = issues;
  }
}

export abstract class DtoBase {
  // ─────────────── Instantiation Secret ───────────────

  private static readonly INSTANTIATION_SECRET = Symbol(
    "DtoBaseInstantiationSecret"
  );

  public static getSecret(): symbol {
    return DtoBase.INSTANTIATION_SECRET;
  }

  // ─────────────── Shared Normalizers ───────────────

  /**
   * Shared helper for normalized "name-like" fields:
   * - Trims input.
   * - When validate=true:
   *     • requires non-empty string
   *     • enforces /^[A-Za-z][A-Za-z\s'-]*$/ pattern
   *
   * Can be used by givenName, lastName, actName, businessName, etc.
   */
  public static normalizeRequiredName(
    value: unknown,
    fieldLabel: string,
    opts?: { validate?: boolean }
  ): string {
    const raw =
      typeof value === "string"
        ? value.trim()
        : value == null
        ? ""
        : String(value).trim();

    if (!opts?.validate) {
      // Non-validating paths (e.g. from DB) just get trimmed text.
      return raw;
    }

    if (!raw) {
      throw new Error(
        `${fieldLabel}: field is required and must not be empty.`
      );
    }

    const pattern = /^[A-Za-z][A-Za-z\s'-]*$/;
    if (!pattern.test(raw)) {
      throw new Error(
        `${fieldLabel}: must contain only letters, spaces, apostrophes, or hyphens; digits and other characters are not allowed.`
      );
    }

    return raw;
  }

  // ─────────────── Identity & Meta ───────────────

  /** Canonical wire id; UUIDv4, immutable once set. */
  protected _id?: string;

  protected _createdAt?: string;
  protected _updatedAt?: string;
  protected _updatedByUserId?: string;
  protected _ownerUserId?: string;

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

  // ─────────────── ID Lifecycle ───────────────

  public setIdOnce(id: string): void {
    const normalized = validateUUIDv4String(id);

    if (this._id && this._id !== normalized) {
      throw new Error(
        `DTO_ID_IMMUTABLE: Attempt to overwrite existing _id '${this._id}' with '${normalized}'.`
      );
    }

    this._id = normalized;
  }

  public ensureId(): string {
    if (this._id) {
      const normalized = validateUUIDv4String(this._id);
      this._id = normalized;
      return normalized;
    }

    const fresh = newUuid();
    this._id = fresh;
    return fresh;
  }

  public getId(): string {
    if (!this._id) {
      throw new Error(
        "DTO_ID_MISSING: getId() called on DTO instance without an assigned `_id`. " +
          "Call hasId()/ensureId() first or fix the call site."
      );
    }
    return this._id;
  }

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

  public requireCollectionName(): string {
    const name = this.getCollectionName();
    if (!name) {
      throw new Error(
        "DTO_COLLECTION_MISSING: DTO instance has no collectionName. " +
          "Ops: ensure Registry seeded dbCollectionName() via setCollectionName()."
      );
    }
    return name;
  }

  // ─────────────── Meta Handling ───────────────

  protected setMeta(meta?: DtoMeta): void {
    if (!meta) return;
    this._createdAt = meta.createdAt ?? this._createdAt;
    this._updatedAt = meta.updatedAt ?? this._updatedAt;
    this._updatedByUserId = meta.updatedByUserId ?? this._updatedByUserId;
    this._ownerUserId = meta.ownerUserId ?? this._ownerUserId;
  }

  public stampCreatedAt(date?: Date | string): void {
    if (this._createdAt) return;

    if (typeof date === "string") {
      this._createdAt = date;
      return;
    }

    const d = date ?? new Date();
    this._createdAt = d.toISOString();
  }

  public stampOwnerUserId(userId?: string): void {
    if (this._ownerUserId) return;
    const trimmed = (userId ?? "").trim();
    if (!trimmed) return;
    this._ownerUserId = trimmed;
  }

  public stampUpdatedAt(userId?: string, date?: Date | string): void {
    if (typeof date === "string") {
      this._updatedAt = date;
    } else {
      const d = date ?? new Date();
      this._updatedAt = d.toISOString();
    }

    const trimmed = (userId ?? "").trim();
    if (trimmed) {
      this._updatedByUserId = trimmed;
    }
  }

  protected _finalizeToJson<TBody extends object>(
    body: TBody
  ): TBody & DtoMeta {
    return {
      ...(body as object),
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      updatedByUserId: this._updatedByUserId,
      ownerUserId: this._ownerUserId,
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

  // ─────────────── Cloning (aligned with ID semantics) ───────────────

  public clone(newId?: string): this {
    const ctor = this.constructor as { new (...args: any[]): any };
    const copy = new ctor(DtoBase.getSecret()) as this;

    Object.assign(copy, this);

    if (newId !== undefined) {
      (copy as any)._id = undefined;
      copy.setIdOnce(newId);
    }

    return copy;
  }

  // ─────────────── Abstracts / Expectations ───────────────

  public abstract getType(): string;

  public abstract toBody(): unknown;
}
