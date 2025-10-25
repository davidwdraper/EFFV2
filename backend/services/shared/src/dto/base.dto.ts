// backend/services/shared/src/dto/base.dto.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env)
 *
 * Purpose:
 * - Abstract foundation for all DTOs.
 * - Unifies metadata + _id handling, safe serialization, and validation ergonomics.
 *
 * Rules:
 * - DTOs are pure (no I/O/logging).
 * - No external “contracts” — each concrete DTO is its own authority.
 * - Nothing internal is exported; data escapes only via getters and toJson().
 *
 * Ops Note:
 * - All thrown errors include guidance to speed triage.
 */

// Internal-only metadata shape (NOT exported)
type _DtoMeta = {
  createdAt?: string; // ISO-8601
  updatedAt?: string; // ISO-8601
  updatedByUserId?: string; // opaque id
};

export abstract class BaseDto {
  // DB primary key (private), gospel internally; surface as <slug>Id via subclass getter.
  private _id?: string;

  // Canonical operational metadata present on all DTOs (private).
  private _meta: _DtoMeta;

  protected constructor(args?: { id?: string } & _DtoMeta) {
    this._id = args?.id;
    this._meta = {
      createdAt: args?.createdAt,
      updatedAt: args?.updatedAt,
      updatedByUserId: args?.updatedByUserId,
    };
  }

  // ---- ID accessors (subclasses expose a friendly alias like xxxId) ----
  protected get _internalId(): string | undefined {
    return this._id;
  }
  protected _setInternalId(id?: string): void {
    this._id = id;
  }

  // ---- Metadata getters (read-only to callers) ----
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
   * Set/merge metadata. If only updatedByUserId is provided, auto-stamp updatedAt.
   * Callers (controllers/services) provide explicit values — no hidden clocks required.
   */
  public setMeta(meta: Partial<_DtoMeta> & { updatedByUserId?: string }): this {
    const next: _DtoMeta = { ...this._meta, ...meta };
    if (meta.updatedByUserId && !meta.updatedAt) {
      next.updatedAt = new Date().toISOString();
    }
    this._meta = next;
    return this;
  }

  /**
   * Helper for subclasses: merge current meta/_id into a body before validation.
   * Avoids per-DTO boilerplate and drift.
   */
  protected _composeForValidation<T extends Record<string, unknown>>(
    body: T
  ): T {
    const withMeta: Record<string, unknown> = { ...body };
    if (this._id) withMeta._id = this._id;
    if (this._meta.createdAt) withMeta.createdAt = this._meta.createdAt;
    if (this._meta.updatedAt) withMeta.updatedAt = this._meta.updatedAt;
    if (this._meta.updatedByUserId)
      withMeta.updatedByUserId = this._meta.updatedByUserId;
    return withMeta as T;
  }

  /**
   * Helper for subclasses: after schema validation, extract + persist _id/meta
   * and return the remaining pure state object for storage inside the DTO.
   */
  protected _extractMetaAndId<T extends Record<string, unknown>>(
    validated: T
  ): Omit<T, "_id" | "createdAt" | "updatedAt" | "updatedByUserId"> {
    const { _id, createdAt, updatedAt, updatedByUserId, ...rest } =
      validated as Record<string, unknown>;
    this._setInternalId(typeof _id === "string" ? _id : undefined);
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
    return rest as Omit<
      T,
      "_id" | "createdAt" | "updatedAt" | "updatedByUserId"
    >;
  }

  /**
   * Merge metadata + id into the serialized output.
   * Subclasses should call this inside toJson().
   */
  protected _withMeta<T extends Record<string, unknown>>(body: T): T {
    const out: Record<string, unknown> = { ...body };
    if (this._id) out._id = this._id;
    if (this._meta.createdAt) out.createdAt = this._meta.createdAt;
    if (this._meta.updatedAt) out.updatedAt = this._meta.updatedAt;
    if (this._meta.updatedByUserId)
      out.updatedByUserId = this._meta.updatedByUserId;
    return out as T;
  }

  /** Convert DTO to canonical wire-safe JSON representation. */
  public abstract toJson(): unknown;

  /** Construct a DTO from validated JSON. Must be overridden by subclasses. */
  public static fromJson(_json: unknown): BaseDto {
    throw new Error(
      "BaseDto.fromJson must be implemented by subclass. Ops: verify the concrete DTO implements fromJson()."
    );
  }
}

/**
 * Validation error used by DTOs when schema validation fails.
 * Includes per-field issues AND an Ops triage hint.
 */
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
      "Ops: Check caller payload against DTO requirements; confirm versions match; re-run with DEBUG to capture the failing field(s). If this originates from persistence, inspect the collection for out-of-spec documents.";
  }
}
