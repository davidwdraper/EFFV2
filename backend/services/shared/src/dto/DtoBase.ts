// backend/services/shared/src/dto/DtoBase.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)  [collection no longer sourced from env]
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4 or 24-hex Mongo id; immutable; WARN on overwrite attempt)
 *
 * Purpose:
 * - Abstract DTO base with a single outbound JSON path.
 * - Meta stamping (createdAt/updatedAt/updatedByUserId) happens **inside toJson()** via helper.
 * - Adds optional instantiation secret enforcement (Registry-only construction).
 * - Adds canonical ID lifecycle: immutable once set, validated format, WARN on overwrite attempts.
 *
 * Notes:
 * - DTOs remain pure (no business logging). Handlers/services log operational details.
 * - **No DB shape here**: this base never reads/writes `_id`. Canonical id exposure is up to concrete DTOs.
 * - Instance-level collection seeding (set once by Registry); DB ops require it via requireCollectionName().
 */

import { isValidUuidV4, newUuid } from "../utils/uuid";

// ─────────────────────────── Secret Key ───────────────────────────
const DTO_SECRET = Symbol("DTO_SECRET");

// Accept either UUIDv4 or a 24-hex Mongo ObjectId string as a valid DTO id.
function isValidDtoIdFormat(id: string): boolean {
  const v = (id ?? "").trim();
  if (!v) return false;

  // Mongo ObjectId format: 24 hex chars
  const isMongoHex = /^[0-9a-fA-F]{24}$/.test(v);

  // UUIDv4 format
  const isUuid = isValidUuidV4(v);

  return isMongoHex || isUuid;
}

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
      "Ops: Check caller payload against DTO requirements; confirm versions match; re-run with DEBUG and requestId to capture the failing field(s).";
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

// Minimal warn hook to avoid hard dependency on a logger inside DTOs.
type _WarnLike = (payload: Record<string, unknown>) => void;
type _DtoMeta = {
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export abstract class DtoBase {
  // ---- Process-wide defaults (configured at boot) ----
  private static _defaults = { updatedByUserId: "system" };
  private static _warn?: _WarnLike;

  /** Expose the secret to Registry and subclasses */
  public static getSecret(): symbol {
    return DTO_SECRET;
  }

  /** Optional enforcement toggle for constructor discipline */
  protected static _requireSecret = false;

  /** Call once at service boot. */
  public static configureDefaults(opts: { updatedByUserId?: string }): void {
    if (opts.updatedByUserId)
      DtoBase._defaults.updatedByUserId = opts.updatedByUserId;
  }

  /**
   * Optional: provide a warn sink (e.g., logger.warn) for soft violations.
   * DTOs themselves remain logging-light; this hook avoids tight coupling.
   */
  public static configureWarn(warn: _WarnLike): void {
    DtoBase._warn = warn;
  }

  // ---- Canonical ID (UUIDv4 or 24-hex Mongo id; immutable once set) ----
  private _id?: string;

  /** True if an id has been set on this instance. */
  public hasId(): boolean {
    return typeof this._id === "string" && this._id.length > 0;
  }

  /** Getter exposes the canonical string id (throws if unset to avoid silent misuse). */
  public get id(): string {
    if (!this._id) {
      throw new Error(
        "DTO_ID_UNSET: id requested before assignment. Ops: ensure controller/DbWriter sets id prior to persistence; readers should hydrate from stored value."
      );
    }
    return this._id;
  }

  /**
   * One-shot setter:
   * - First assignment must be a valid DTO id:
   *     • UUIDv4 (case-insensitive), OR
   *     • 24-hex Mongo ObjectId string.
   * - Stored lowercase for stability.
   * - Subsequent attempts are a no-op and emit WARN (investigate call site).
   */
  public set id(value: string) {
    const ctorName = (this as any)?.constructor?.name ?? "DTO";

    if (this._id) {
      DtoBase._warn?.({
        component: "BaseDto",
        event: "id_overwrite_ignored",
        dto: ctorName,
        existing: this._id,
        attempted: value,
        hint: "ID is immutable; investigate caller attempting to replace it.",
      });
      return; // no-op per ADR-0057
    }

    const v = (value ?? "").trim();
    if (!isValidDtoIdFormat(v)) {
      throw new DtoValidationError("INVALID_ID_FORMAT", [
        {
          path: "id",
          code: "invalid_id_format",
          message:
            "id must be a UUIDv4 or a 24-hex Mongo ObjectId string (normalized, non-empty).",
        },
      ]);
    }

    this._id = v.toLowerCase();
  }

  /** Ensure an id exists (UUIDv4 auto-generation path); returns the id. */
  public ensureId(): string {
    if (!this._id) {
      this._id = newUuid();
    }
    return this._id;
  }

  // ---- Instance-level collection (seeded once by Registry) ----
  private _collectionName?: string;

  public setCollectionName(name: string): this {
    const ctor = (this as any).constructor as { name?: string };
    const trimmed = (name ?? "").trim();
    if (!trimmed) {
      throw new Error(
        `DTO_COLLECTION_EMPTY: ${
          ctor.name ?? "DTO"
        } received empty collection. Ops: Registry must seed dto.setCollectionName(<hardwired>); handlers must not set/override.`
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
      } missing instance collection. Ops: ensure the service Registry calls dto.setCollectionName(<hardwired>) during instantiation.`
    );
  }

  // ---- Cloning (ADR-0057: new UUIDv4 id, preserved collection) ----

  /**
   * Deep clone as a new instance with a NEW UUIDv4 id (ADR-0057).
   *
   * Invariants:
   * - Subclasses MUST implement: static fromJson(json, opts?) and (optionally) dbCollectionName().
   * - Cloning:
   *    • Rehydrates from current wire state (this.toJson()) without revalidation.
   *    • Assigns a brand-new UUIDv4 id (or the supplied override).
   *    • Preserves the instance collection name on the clone, falling back to dbCollectionName().
   *
   * Ops:
   * - If this throws DTO_CLONE_UNSUPPORTED, fix the concrete DTO so it implements fromJson().
   */
  public clone<T extends DtoBase>(this: T, newId?: string): T {
    const ctor = this.constructor as any;

    if (typeof ctor.fromJson !== "function") {
      const name = ctor?.name ?? "DTO";
      throw new Error(
        `DTO_CLONE_UNSUPPORTED: ${name} is missing static fromJson(). ` +
          "Ops: ensure this DTO implements fromJson(json, opts?) per ADR-0057 so clone() remains consistent."
      );
    }

    // Rehydrate from current wire state (no revalidation).
    const next = ctor.fromJson(this.toJson(), { validate: false }) as T;

    // Assign NEW id (or supplied override) — bypass previous id while still
    // using the canonical setter for validation & normalization.
    const idToUse = newId ?? newUuid();
    if (!isValidUuidV4(idToUse)) {
      throw new DtoValidationError("INVALID_ID_FORMAT", [
        {
          path: "id",
          code: "invalid_uuid_v4",
          message:
            "clone() received an invalid id override; must be a UUIDv4 string.",
        },
      ]);
    }
    (next as any)._id = undefined;
    (next as any).id = idToUse;

    // Preserve instance collection to avoid DTO_COLLECTION_UNSET.
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

  // ---- Meta ----
  private _meta: _DtoMeta;

  protected constructor(secretOrArgs?: symbol | _DtoMeta) {
    // Enforce instantiation only via Registry if required
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
