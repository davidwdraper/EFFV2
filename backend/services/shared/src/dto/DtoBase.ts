// backend/services/shared/src/dto/DtoBase.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)  [collection no longer sourced from env]
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *
 * Purpose:
 * - Abstract DTO base with a single outbound JSON path.
 * - Meta stamping (createdAt/updatedAt/updatedByUserId) happens **inside toJson()** via helper.
 * - Adds optional instantiation secret enforcement (Registry-only construction).
 *
 * Notes:
 * - DTOs remain pure (no business logging). Handlers/services log operational details.
 * - **No DB shape here**: this base never reads/writes `_id`. Canonical id exposure is up to concrete DTOs.
 * - Instance-level collection seeding (set once by Registry); DB ops require it via requireCollectionName().
 */

// ─────────────────────────── Secret Key ───────────────────────────
// Shared across all DTOs; only the Registry should use it.
// Not a cryptographic secret — architectural discipline only.
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

export abstract class BaseDto {
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
      BaseDto._defaults.updatedByUserId = opts.updatedByUserId;
  }

  /**
   * Optional: provide a warn sink (e.g., logger.warn) for soft violations.
   * DTOs themselves remain logging-light; this hook avoids tight coupling.
   */
  public static configureWarn(warn: _WarnLike): void {
    BaseDto._warn = warn;
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
    BaseDto._warn?.({
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

  // ---- Meta ----
  private _meta: _DtoMeta;

  protected constructor(secretOrArgs?: symbol | _DtoMeta) {
    // Enforce instantiation only via Registry if required
    if (BaseDto._requireSecret && secretOrArgs !== DTO_SECRET) {
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
      this._meta.updatedByUserId = BaseDto._defaults.updatedByUserId;
    const out: Record<string, unknown> = { ...body };
    out.createdAt = this._meta.createdAt;
    out.updatedAt = this._meta.updatedAt;
    out.updatedByUserId = this._meta.updatedByUserId;
    return out as T;
  }

  public abstract toJson(): unknown;
  public static fromJson(_json: unknown): BaseDto {
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
