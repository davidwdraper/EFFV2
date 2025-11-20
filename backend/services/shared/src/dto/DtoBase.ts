// backend/services/shared/src/dto/DtoBase.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (SvcEnv DTO contract)
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *   - ADR-0057 (R1) — ID Generation & Validation (UUIDv4 only; immutable; WARN on overwrite)
 *
 * Purpose:
 * - Abstract DTO base with single outbound JSON path and canonical ID lifecycle.
 * - Meta stamping (createdAt/updatedAt/updatedByUserId) occurs inside toJson().
 * - Optional constructor secret enforcement (Registry-only construction).
 */

import { newUuid, validateUUIDv4String } from "../utils/uuid";
import { IDto } from "./IDto";

// ─────────────────────────── Secret Key ───────────────────────────
const DTO_SECRET = Symbol("DTO_SECRET");

export class DtoValidationError extends Error {
  public readonly issues: Array<{
    path: string;
    code: string;
    message: string;
  }>;
  public readonly opsHint: string;
  constructor(
    message: string,
    issues: Array<{ path: string; code: string; message: string }>,
    opsHint?: string
  ) {
    super(message);
    this.name = "DtoValidationError";
    this.issues = issues;
    this.opsHint =
      opsHint ??
      "Ops: Check caller payload against DTO requirements; confirm versions match; re-run with DEBUG and requestId.";
  }
}

export class DtoMutationUnsupportedError extends Error {
  constructor(dtoName: string, method: "updateFrom" | "patchFrom") {
    super(
      `${dtoName} does not support ${method}(). Ops: this DTO is immutable; use the approved reload/replace flow instead.`
    );
    this.name = "DtoMutationUnsupportedError";
  }
}

type _WarnLike = (payload: Record<string, unknown>) => void;
type _DtoMeta = {
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export abstract class DtoBase implements IDto {
  private static _defaults = { updatedByUserId: "system" };
  private static _warn?: _WarnLike;

  public static getSecret(): symbol {
    return DTO_SECRET;
  }
  protected static _requireSecret = true;

  public static configureDefaults(opts: { updatedByUserId?: string }): void {
    if (opts.updatedByUserId)
      DtoBase._defaults.updatedByUserId = opts.updatedByUserId;
  }
  public static configureWarn(warn: _WarnLike): void {
    DtoBase._warn = warn;
  }

  // ─────────────────────────── Canonical _id (UUIDv4; immutable) ───────────────────────────

  /**
   * Backing field for the DTO id.
   * - Always a UUIDv4 string when set.
   * - Never mutated after first assignment (setIdOnce()).
   */
  private _idValue?: string;

  /** Whether this DTO already has an assigned _id */
  public hasId(): boolean {
    return typeof this._idValue === "string" && this._idValue.length > 0;
  }

  /**
   * Public getter literally named `_id`.
   * Throws if accessed before assignment to surface lifecycle bugs early.
   */
  public get _id(): string {
    if (!this._idValue) {
      throw new Error(
        "DTO_ID_UNSET: _id requested before assignment. Ops: ensure controller/DbWriter assigns id via setIdOnce() before persistence; readers must hydrate via fromJson()."
      );
    }
    return this._idValue;
  }

  public getId(): string {
    return this._id;
  }

  // ─────────────── IDto contract ───────────────
  public getType(): string {
    throw new Error("getType must overriden in derived DTO class");
  }

  /**
   * Write-once setter for the DTO id.
   *
   * Contract:
   * - First assignment:
   *   • Validates the value is a UUIDv4 via validateUUIDv4String().
   *   • Normalizes to lowercase and stores it.
   * - Subsequent assignments:
   *   • Are ignored (no-op).
   *   • Emit a WARN via DtoBase._warn with guidance for Ops.
   */
  public setIdOnce(value: string): void {
    const ctorName = (this as any)?.constructor?.name ?? "DTO";

    if (this._idValue) {
      DtoBase._warn?.({
        component: "BaseDto",
        event: "id_overwrite_ignored",
        dto: ctorName,
        existing: this._idValue,
        attempted: value,
        hint: "ID is immutable; investigate caller attempting to replace it.",
      });
      return;
    }

    const normalized = validateUUIDv4String(value); // throws with Ops guidance if invalid
    this._idValue = normalized.toLowerCase();
  }

  /**
   * Auto-generate a UUIDv4 _id if missing; returns the assigned id.
   * Uses centralized helpers to ensure all IDs are minted/validated consistently.
   */
  public ensureId(): string {
    if (!this._idValue) {
      const v = newUuid();
      const normalized = validateUUIDv4String(v);
      this._idValue = normalized.toLowerCase();
    }
    return this._idValue;
  }

  // ─────────────────────────── Instance-level collection (seeded once by Registry) ───────────────────────────

  private _collectionName?: string;

  public setCollectionName(name: string): this {
    const ctor = (this as any).constructor as { name?: string };
    const trimmed = (name ?? "").trim();
    if (!trimmed) {
      throw new Error(
        `DTO_COLLECTION_EMPTY: ${
          ctor.name ?? "DTO"
        } received empty collection. Ops: Registry must seed dto.setCollectionName(<hardwired>).`
      );
    }
    if (!this._collectionName) {
      this._collectionName = trimmed;
      return this;
    }
    if (this._collectionName === trimmed) return this;
    DtoBase._warn?.({
      component: "BaseDto",
      event: "collection_name_already_set",
      dto: ctor.name ?? "DTO",
      existing: this._collectionName,
      attempted: trimmed,
      hint: "Registry seeds collection once; callers must not override.",
    });
    return this;
  }

  public requireCollectionName(): string {
    if (this._collectionName && this._collectionName.trim())
      return this._collectionName;
    const ctor = (this as any).constructor as { name?: string };
    throw new Error(
      `DTO_COLLECTION_UNSET: ${
        ctor.name ?? "DTO"
      } missing instance collection. Ops: ensure the service Registry calls dto.setCollectionName(<hardwired>).`
    );
  }

  // ─────────────────────────── Cloning (brand-new UUIDv4 id, preserved collection) ───────────────────────────

  public clone<T extends DtoBase>(this: T, newId?: string): T {
    const ctor = this.constructor as any;

    if (typeof ctor.fromJson !== "function") {
      const name = ctor?.name ?? "DTO";
      throw new Error(
        `DTO_CLONE_UNSUPPORTED: ${name} is missing static fromJson(). ` +
          "Ops: ensure this DTO implements fromJson(json, opts?) per ADR-0057."
      );
    }

    let next: any;
    try {
      next = ctor.fromJson(this.toJson(), { validate: false }) as T;
    } catch {
      throw new DtoValidationError("ctor.fromJson(this.toJson()) - FAILED", [
        {
          path: "_id",
          code: "invalid_uuid_v4",
          message: `toJson -> fromJson cloning failed, for this._id: ${this._id}`,
        },
      ]);
    }

    const rawId = newId ?? newUuid();
    let normalized: string;
    try {
      normalized = validateUUIDv4String(rawId);
    } catch {
      throw new DtoValidationError("INVALID_ID_FORMAT", [
        {
          path: "_id",
          code: "invalid_uuid_v4",
          message: "clone() id must be UUIDv4",
        },
      ]);
    }

    // Reset any existing id on the cloned instance before assigning a new one.
    (next as any)._idValue = undefined;
    next.setIdOnce(normalized);

    const coll =
      (this as any)._collectionName ??
      (typeof ctor.dbCollectionName === "function"
        ? ctor.dbCollectionName()
        : undefined);

    if (coll && typeof (next as any).setCollectionName === "function") {
      (next as any).setCollectionName(coll);
    }

    return next;
  }

  // ─────────────────────────── Meta ───────────────────────────

  private _meta: _DtoMeta;

  protected constructor(secretOrArgs?: symbol | _DtoMeta) {
    if (DtoBase._requireSecret && secretOrArgs !== DTO_SECRET) {
      throw new Error(
        "Direct instantiation of DTOs is not allowed. Use the Registry to construct DTOs."
      );
    }

    const args =
      typeof secretOrArgs === "symbol" ? undefined : (secretOrArgs as _DtoMeta);

    this._meta = {
      createdAt: args?.createdAt,
      updatedAt: args?.updatedAt,
      updatedByUserId: args?.updatedByUserId,
    };
  }

  get createdAt(): string | undefined {
    return this._meta.createdAt;
  }
  get updatedAt(): string | undefined {
    return this._meta.updatedAt;
  }
  get updatedByUserId(): string | undefined {
    return this._meta.updatedByUserId;
  }

  public setMeta(meta: Partial<_DtoMeta> & { updatedByUserId?: string }): this {
    const next: _DtoMeta = { ...this._meta, ...meta };
    if (meta.updatedByUserId && !meta.updatedAt)
      next.updatedAt = new Date().toISOString();
    this._meta = next;
    return this;
  }

  protected _composeForValidation<T extends Record<string, unknown>>(
    body: T
  ): T {
    const withMeta: Record<string, unknown> = { ...body };
    if (this._meta.createdAt) withMeta.createdAt = this._meta.createdAt;
    if (this._meta.updatedAt) withMeta.updatedAt = this._meta.updatedAt;
    if (this._meta.updatedByUserId)
      withMeta.updatedByUserId = this._meta.updatedByUserId;
    return withMeta as T;
  }

  protected _extractMetaAndId<T extends Record<string, unknown>>(
    validated: T
  ): Omit<T, "createdAt" | "updatedAt" | "updatedByUserId"> {
    const { createdAt, updatedAt, updatedByUserId, ...rest } =
      validated as Record<string, unknown>;
    this._meta = {
      createdAt:
        typeof createdAt === "string" ? createdAt : this._meta.createdAt,
      updatedAt:
        typeof updatedAt === "string" ? updatedAt : this._meta.updatedAt,
      updatedByUserId:
        typeof updatedByUserId === "string"
          ? updatedByUserId
          : this._meta.updatedByUserId,
    };
    return rest as Omit<T, "createdAt" | "updatedAt" | "updatedByUserId">;
  }

  protected _finalizeToJson<T extends Record<string, unknown>>(body: T): T {
    const now = new Date().toISOString();
    if (!this._meta.createdAt) this._meta.createdAt = now;
    this._meta.updatedAt = now;
    if (!this._meta.updatedByUserId)
      this._meta.updatedByUserId = DtoBase._defaults.updatedByUserId;
    const out: Record<string, unknown> = { ...body };
    out.createdAt = this._meta.createdAt;
    out.updatedAt = this._meta.updatedAt;
    out.updatedByUserId = this._meta.updatedByUserId;
    return out as T;
  }

  public abstract toJson(): unknown;

  public static fromJson(_json: unknown): DtoBase {
    throw new Error(
      "BaseDto.fromJson must be implemented by subclass. Ops: verify the concrete DTO implements fromJson()."
    );
  }

  public updateFrom(_other: this): this {
    throw new DtoMutationUnsupportedError(this.constructor.name, "updateFrom");
  }

  public patchFrom(_json: unknown): this {
    throw new DtoMutationUnsupportedError(this.constructor.name, "patchFrom");
  }
}
