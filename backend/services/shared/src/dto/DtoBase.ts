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
 *   - ADR-0078 (DTO write-once private fields; setters in / getters out)
 *   - ADR-0079 (DtoBase.check — single normalization/validation gate)
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
 *   • Shared normalization/validation via DtoBase.check().
 */

import { newUuid, validateUUIDv4String } from "../utils/uuid";
import { UserType } from "./UserType";

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
 * Validation error used by DTOs when they perform
 * per-DTO validation (e.g., EnvServiceDto.fromBody with validate=true).
 *
 * All failures from DtoBase.check() MUST throw this type.
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

// ─────────────── DtoBase.check() types ───────────────

export type CheckKind =
  | "string"
  | "stringOpt"
  | "number"
  | "numberOpt"
  | "boolean"
  | "booleanOpt";

export type Validator<T> = (value: T) => void; // throws DtoValidationError on failure

export type CheckOptions<T> = {
  // When true, validation runs (type + normalization + custom validator).
  // When false/omitted, check() still normalizes but does not enforce custom validation.
  validate?: boolean;

  // Field/path name used for errors (required when validate=true).
  path?: string;

  // Optional, shared or DTO-specific validator.
  validator?: Validator<T>;

  // Optional, additional normalization after base normalization.
  normalize?: (value: T) => T;
};

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
   *
   * NOTE:
   * - This is legacy/specialized. New DTOs should prefer DtoBase.check()
   *   plus a dedicated validator instead of calling this directly.
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

  // ─────────────── DtoBase.check() — single gate (ADR-0079) ───────────────

  /**
   * Single DTO-internal gate for normalization + validation of inbound values.
   *
   * Requirements (ADR-0079):
   * - DTO fromBody() MUST call DtoBase.check() then set via setters.
   * - DTO toBody() reads via getters only; it does not use check().
   * - No logging. No defaults. No guessing.
   *
   * Semantics by kind:
   * - "string":
   *     • returns string (trimmed).
   *     • if validate=true: rejects non-string OR empty-after-trim.
   * - "stringOpt":
   *     • returns string | undefined (trimmed; empty → undefined).
   *     • non-string: if validate=true → error; else → undefined.
   * - "number":
   *     • accepts number or numeric string.
   *     • returns integer via Math.trunc(n).
   *     • if validate=true: rejects invalid / non-finite.
   * - "numberOpt":
   *     • returns number | undefined.
   *     • invalid / non-finite → undefined (even when validate=true)
   *       unless a custom validator rejects.
   * - "boolean":
   *     • accepts boolean only.
   *     • if validate=true: rejects non-boolean.
   *     • if validate=false: non-boolean coerced via Boolean(input).
   * - "booleanOpt":
   *     • returns boolean | undefined.
   *     • null/undefined → undefined.
   *     • non-boolean: if validate=true → error; else → Boolean(input).
   */
  public static check<T>(
    input: unknown,
    kind: CheckKind,
    opts?: CheckOptions<T>
  ): T {
    const validate = opts?.validate === true;
    const path = opts?.path ?? "<unknown>";

    const fail = (code: string, message: string): never => {
      if (validate && !opts?.path) {
        throw new DtoValidationError("DTO_CHECK_PATH_REQUIRED", [
          {
            path: "<missing>",
            code: "path_required",
            message:
              "DtoBase.check called with validate=true but without a path.",
          },
        ]);
      }

      throw new DtoValidationError(`DTO_CHECK_INVALID: ${path} — ${message}`, [
        {
          path,
          code,
          message,
        },
      ]);
    };

    let value: unknown;

    switch (kind) {
      case "string": {
        if (typeof input !== "string") {
          if (validate) {
            fail("type", "Expected string.");
          }
          // Non-validating path — best-effort coercion.
          value = String(input ?? "").trim();
        } else {
          value = input.trim();
        }

        const s = value as string;
        if (validate && !s) {
          fail("required", "Non-empty string is required.");
        }

        break;
      }

      case "stringOpt": {
        if (input == null) {
          value = undefined;
          break;
        }

        if (typeof input !== "string") {
          if (validate) {
            fail("type", "Expected string or undefined.");
          }
          // Non-validating: treat non-string as undefined.
          value = undefined;
          break;
        }

        const trimmed = input.trim();
        value = trimmed ? trimmed : undefined;
        break;
      }

      case "number": {
        let n: number;

        if (typeof input === "number") {
          n = input;
        } else if (typeof input === "string") {
          const trimmed = input.trim();
          n = trimmed ? Number(trimmed) : NaN;
        } else {
          n = NaN;
        }

        const intVal = Math.trunc(n);

        if (!Number.isFinite(intVal)) {
          if (validate) {
            fail("type", "Expected finite numeric value.");
          }
          value = intVal; // May be NaN in non-validating paths.
        } else {
          value = intVal;
        }

        break;
      }

      case "numberOpt": {
        if (input == null || input === "") {
          value = undefined;
          break;
        }

        let n: number;

        if (typeof input === "number") {
          n = input;
        } else if (typeof input === "string") {
          const trimmed = input.trim();
          n = trimmed ? Number(trimmed) : NaN;
        } else {
          n = NaN;
        }

        const intVal = Math.trunc(n);
        value = Number.isFinite(intVal) ? intVal : undefined;
        // Note: even when validate=true, invalid numeric becomes undefined,
        // unless a custom validator rejects.
        break;
      }

      case "boolean": {
        if (typeof input === "boolean") {
          value = input;
        } else if (validate) {
          fail("type", "Expected boolean.");
        } else {
          // Non-validating mode: best-effort coercion.
          value = Boolean(input);
        }
        break;
      }

      case "booleanOpt": {
        if (input == null) {
          value = undefined;
          break;
        }

        if (typeof input === "boolean") {
          value = input;
          break;
        }

        if (validate) {
          fail("type", "Expected boolean or undefined.");
        }

        // Non-validating mode: best-effort coercion.
        value = Boolean(input);
        break;
      }

      default: {
        fail("kind", `Unsupported CheckKind '${kind as string}'.`);
      }
    }

    // Optional extra normalization hook.
    if (opts?.normalize && value !== undefined) {
      value = opts.normalize(value as T);
    }

    // Optional validator hook (only when validate=true).
    if (validate && opts?.validator && value !== undefined) {
      opts.validator(value as T);
    }

    return value as T;
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
