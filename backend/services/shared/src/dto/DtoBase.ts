// backend/services/shared/src/dto/DtoBase.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Abstract DTO base with a single outbound JSON path.
 * - Meta stamping (createdAt/updatedAt/updatedByUserId) happens **inside toJson()** via helper.
 *
 * Notes:
 * - DTOs remain pure (no logging). Handlers log errors.
 * - **No DB shape here**: this base never reads/writes `_id`. ID exposure (e.g., `xxxId`) is up to concrete DTOs.
 */

type _DtoMeta = {
  createdAt?: string; // ISO-8601
  updatedAt?: string; // ISO-8601
  updatedByUserId?: string; // opaque principal
};

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

type _SvcEnvLike = { getEnvVar: (k: string) => string };

export abstract class BaseDto {
  // ---- Process-wide defaults/env (configured at boot) ----
  private static _defaults = { updatedByUserId: "system" };
  private static _svcEnv?: _SvcEnvLike;

  /** Call once at service boot. */
  public static configureDefaults(opts: { updatedByUserId?: string }): void {
    if (opts.updatedByUserId)
      BaseDto._defaults.updatedByUserId = opts.updatedByUserId;
  }

  /** Call once at service boot with your SvcEnvDto (must expose getEnvVar). */
  public static configureEnv(env: _SvcEnvLike): void {
    BaseDto._svcEnv = env;
  }

  /**
   * Minimal collection resolver:
   * - Subclass must provide `static dbCollectionKey(): string`
   * - We fetch via svcEnv.getEnvVar(key)
   * - Empty/missing → throw with an Ops hint
   */
  public static dbCollectionName(this: unknown): string {
    const ctor = this as { dbCollectionKey?: () => string; name?: string };
    if (!BaseDto._svcEnv) {
      throw new Error(
        "SvcEnv not configured. Ops: wire BaseDto.configureEnv(svcEnvDto) during app boot before using DTOs."
      );
    }
    if (typeof ctor.dbCollectionKey !== "function") {
      throw new Error(
        `DTO ${
          ctor.name ?? "UnknownDto"
        } is missing static dbCollectionKey(). ` +
          `Ops: implement: 'static dbCollectionKey() { return \"NV_COLLECTION_XXX_VALUES\"; }'`
      );
    }
    const key = ctor.dbCollectionKey();
    const value = BaseDto._svcEnv.getEnvVar(key);
    if (!value || !value.trim()) {
      throw new Error(
        `Missing env value for "${key}" required by ${ctor.name ?? "DTO"}. ` +
          `Ops: ensure svcenv provides a non-empty collection name; Dev == Prod (no defaults).`
      );
    }
    return value;
  }

  // ---- Meta (internal only; no DB ids here) ----
  private _meta: _DtoMeta;

  protected constructor(args?: _DtoMeta) {
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
