// backend/services/shared/src/dto/DtoBase.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *   - ADR-0103 (DTO naming convention: keys, filenames, classnames)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 *   - ADR-0057 (ID Generation & Validation — UUID; immutable)
 *   - ADR-0079 (DtoBase.check — single normalization/validation gate)
 *
 * Purpose:
 * - Base class for all DTOs.
 * - Owns canonical `_id` lifecycle (UUID, set-once) and collection-name plumbing.
 * - Owns meta stamping utilities used by DbWriter workers (createdAt/updatedAt/owner).
 *
 * NOTE:
 * - Instantiation secret is owned by the registry module (ADR-0102).
 * - DTOs must never be constructed without the registry secret.
 */

import { DTO_INSTANTIATION_SECRET } from "../registry/dtoInstantiationSecret";
import { newUuid, validateUUIDString, isValidUuid } from "../utils/uuid";
import { UserType } from "./UserType";

export type DtoMeta = {
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
  ownerUserId?: string;
};

export type DtoCtorOpts = {
  body?: unknown;
  validate?: boolean;
  mode?: "wire" | "db";
};

export type CheckKind =
  | "string"
  | "stringOpt"
  | "number"
  | "numberOpt"
  | "boolean"
  | "booleanOpt";

export type Validator<T> = (value: T | undefined) => void;

export type DtoValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export class DtoValidationError extends Error {
  public readonly issues: ReadonlyArray<DtoValidationIssue>;

  public constructor(
    message: string,
    issues: ReadonlyArray<DtoValidationIssue>
  ) {
    super(message);
    this.name = "DtoValidationError";
    this.issues = Array.isArray(issues) ? issues : [];
  }
}

export abstract class DtoBase {
  public static getSecret(): symbol {
    return DTO_INSTANTIATION_SECRET;
  }

  /**
   * ADR-0079: single, shared normalization/validation gate.
   *
   * - Required-vs-optional semantics are controlled by `kind`.
   * - Validators are executed only when a value exists (or after required enforcement).
   */
  public static check<T>(
    input: unknown,
    kind: CheckKind,
    opts: {
      path: string;
      normalize?: (v: any) => any;
      validators?: ReadonlyArray<Validator<any>>;
    }
  ): T {
    const path = String(opts?.path ?? "").trim() || "<unknown>";
    const normalize = opts?.normalize;
    const validators = opts?.validators ?? [];

    const raw = normalize ? normalize(input) : input;

    const throwType = (expected: string): never => {
      throw new DtoValidationError(`Invalid value at "${path}"`, [
        { path, code: "type", message: `Expected ${expected}.` },
      ]);
    };

    const runValidators = (v: any) => {
      for (const fn of validators) fn(v);
    };

    switch (kind) {
      case "stringOpt": {
        if (raw === undefined || raw === null) return undefined as unknown as T;
        if (typeof raw !== "string") throwType("string");
        const v = raw;
        runValidators(v);
        return v as unknown as T;
      }

      case "string": {
        if (raw === undefined || raw === null) {
          throw new DtoValidationError(`Missing required value at "${path}"`, [
            { path, code: "required", message: "Value is required." },
          ]);
        }
        if (typeof raw !== "string") throwType("string");
        const v = raw;
        runValidators(v);
        return v as unknown as T;
      }

      case "numberOpt": {
        if (raw === undefined || raw === null) return undefined as unknown as T;
        if (typeof raw !== "number" || !Number.isFinite(raw)) {
          throwType("finite number");
        }
        const v = raw;
        runValidators(v);
        return v as unknown as T;
      }

      case "number": {
        if (raw === undefined || raw === null) {
          throw new DtoValidationError(`Missing required value at "${path}"`, [
            { path, code: "required", message: "Value is required." },
          ]);
        }
        if (typeof raw !== "number" || !Number.isFinite(raw)) {
          throwType("finite number");
        }
        const v = raw;
        runValidators(v);
        return v as unknown as T;
      }

      case "booleanOpt": {
        if (raw === undefined || raw === null) return undefined as unknown as T;
        if (typeof raw !== "boolean") throwType("boolean");
        const v = raw;
        runValidators(v);
        return v as unknown as T;
      }

      case "boolean": {
        if (raw === undefined || raw === null) {
          throw new DtoValidationError(`Missing required value at "${path}"`, [
            { path, code: "required", message: "Value is required." },
          ]);
        }
        if (typeof raw !== "boolean") throwType("boolean");
        const v = raw;
        runValidators(v);
        return v as unknown as T;
      }

      default: {
        throw new Error(
          `DTO_CHECK_KIND_UNKNOWN: Unsupported CheckKind "${String(
            kind
          )}" at path "${path}".`
        );
      }
    }
  }

  // ─────────────── Identity & Meta ───────────────

  protected _id?: string;

  protected _createdAt?: string;
  protected _updatedAt?: string;
  protected _updatedByUserId?: string;
  protected _ownerUserId?: string;

  // ─────────────── Collection Name ───────────────

  protected _collectionName?: string;

  // ─────────────── Access Control Context ───────────────

  protected _currentUserType: UserType = UserType.Anon;

  protected constructor(secretOrMeta?: symbol | DtoMeta) {
    if (secretOrMeta === DTO_INSTANTIATION_SECRET) return;

    if (typeof secretOrMeta === "object" && secretOrMeta !== null) {
      this.setMeta(secretOrMeta);
      return;
    }

    throw new Error(
      "DTO_INSTANTIATION_DENIED: DTO constructed without the registry secret. " +
        "Ops: use registry.create(dtoKey, body?) only."
    );
  }

  protected initCtor(
    opts: DtoCtorOpts | undefined,
    hydrate: (
      body: unknown,
      hydrateOpts: { validate: boolean; mode?: "wire" | "db" }
    ) => void
  ): void {
    const hasBody =
      !!opts &&
      Object.prototype.hasOwnProperty.call(opts, "body") &&
      opts.body !== undefined;

    if (hasBody) {
      hydrate(opts!.body, {
        validate: opts?.validate === true,
        mode: opts?.mode,
      });
      return;
    }

    this.mintId();
  }

  // ─────────────── ID Lifecycle ───────────────

  public setIdOnce(id: string): void {
    const normalized = validateUUIDString(id);

    if (this._id && this._id !== normalized) {
      throw new Error(
        `DTO_ID_IMMUTABLE: Attempt to overwrite existing _id '${this._id}' with '${normalized}'.`
      );
    }

    this._id = normalized;
  }

  public tryGetId(): string | undefined {
    return this._id ? String(this._id) : undefined;
  }

  public isValidId(id: string): boolean {
    return isValidUuid(id);
  }

  public isValidOwnId(): boolean {
    if (!this._id) return false;
    return this.isValidId(this._id);
  }

  public mintId(): string {
    const fresh = newUuid();
    this._id = fresh;
    return fresh;
  }

  public getId(): string {
    if (!this._id) {
      throw new Error(
        "DTO_ID_MISSING: getId() called on DTO instance without an assigned `_id`."
      );
    }
    return this._id;
  }

  public requireId(): string {
    return this.getId();
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
          "Ops: ensure Registry seeded it via setCollectionName()."
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
    if (typeof date === "string") this._updatedAt = date;
    else {
      const d = date ?? new Date();
      this._updatedAt = d.toISOString();
    }

    const trimmed = (userId ?? "").trim();
    if (trimmed) this._updatedByUserId = trimmed;
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

  // ─────────────── Abstracts ───────────────

  public abstract getType(): string;
  public abstract toBody(): unknown;
}
