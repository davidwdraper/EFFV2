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

/** Thrown when a DTO does not support runtime mutation. Handlers should log as error. */
export class DtoMutationUnsupportedError extends Error {
  constructor(dtoName: string, method: "updateFrom" | "patchFrom") {
    super(
      `${dtoName} does not support ${method}(). Ops: this DTO is immutable; use the approved reload/replace flow instead.`
    );
    this.name = "DtoMutationUnsupportedError";
  }
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

export abstract class BaseDto {
  // Process-wide default principal (set once at boot; no env reads here)
  private static _defaults = {
    updatedByUserId: "system",
  };

  /** Configure default principal once at service boot. */
  public static configureDefaults(opts: { updatedByUserId?: string }): void {
    if (opts.updatedByUserId)
      BaseDto._defaults.updatedByUserId = opts.updatedByUserId;
  }

  // Internal meta only — no internal DB id kept here.
  private _meta: _DtoMeta;

  protected constructor(args?: _DtoMeta) {
    this._meta = {
      createdAt: args?.createdAt,
      updatedAt: args?.updatedAt,
      updatedByUserId: args?.updatedByUserId,
    };
  }

  // ---- Meta getters (read-only) ----
  get createdAt(): string | undefined {
    return this._meta.createdAt;
  }
  get updatedAt(): string | undefined {
    return this._meta.updatedAt;
  }
  get updatedByUserId(): string | undefined {
    return this._meta.updatedByUserId;
  }

  /**
   * Explicit meta merge from callers (controllers/services).
   * If only updatedByUserId is provided, auto-stamp updatedAt.
   */
  public setMeta(meta: Partial<_DtoMeta> & { updatedByUserId?: string }): this {
    const next: _DtoMeta = { ...this._meta, ...meta };
    if (meta.updatedByUserId && !meta.updatedAt)
      next.updatedAt = new Date().toISOString();
    this._meta = next;
    return this;
  }

  /**
   * Helper: merge current meta into a body before schema validation.
   * **Intentionally does NOT inject any id field** (no `_id` here).
   */
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

  /**
   * Helper: after validation, persist meta internally and keep domain state.
   * **Never reads `_id`** and returns the rest as the DTO’s domain data.
   */
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

  /**
   * Finalize outbound JSON (single path): ensure createdAt (if missing),
   * always refresh updatedAt, and ensure updatedByUserId (default if missing).
   * **Never injects `_id`**; concrete DTOs control any id field (e.g., `xxxId`).
   * Called **inside** concrete DTO.toJson() implementations.
   */
  protected _finalizeToJson<T extends Record<string, unknown>>(body: T): T {
    const now = new Date().toISOString();
    if (!this._meta.createdAt) this._meta.createdAt = now;
    this._meta.updatedAt = now;
    if (!this._meta.updatedByUserId)
      this._meta.updatedByUserId = BaseDto._defaults.updatedByUserId;

    const out: Record<string, unknown> = { ...body };
    // NO `_id` here — DTOs are DB-agnostic at the edge.
    out.createdAt = this._meta.createdAt;
    out.updatedAt = this._meta.updatedAt;
    out.updatedByUserId = this._meta.updatedByUserId;
    return out as T;
  }

  /** Subclasses must implement the single outbound JSON path. */
  public abstract toJson(): unknown;

  /** Subclasses must implement a static fromJson. */
  public static fromJson(_json: unknown): BaseDto {
    throw new Error(
      "BaseDto.fromJson must be implemented by subclass. Ops: verify the concrete DTO implements fromJson()."
    );
  }

  // ---- Optional mutation API (immutable by default) ----
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public updateFrom(_other: this): this {
    throw new DtoMutationUnsupportedError(this.constructor.name, "updateFrom");
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public patchFrom(_json: unknown): this {
    throw new DtoMutationUnsupportedError(this.constructor.name, "patchFrom");
  }
}
