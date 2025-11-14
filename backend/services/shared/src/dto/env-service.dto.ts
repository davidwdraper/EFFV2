// backend/services/shared/src/dto/env-service.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *   - ADR-0053 (Instantiation discipline via DtoBase secret)
 *   - ADR-0057 (ID Generation & Validation — id is a string (UUIDv4 or 24-hex Mongo id); immutable; WARN on overwrite attempt)
 *
 * Purpose:
 * - Concrete DTO for env-service configuration records.
 * - Represents a single environment configuration document:
 *     • one document per (env, slug, version)
 *     • vars is a bag of env-style key/value pairs
 */

import { DtoBase, DtoValidationError } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";
import type { IDto } from "./IDto";

// Wire-friendly shape (for clarity)
type EnvServiceJson = {
  id?: string; // canonical id (wire, ADR-0050)
  type?: "env-service"; // dtoType (wire)

  env: string; // e.g. "dev" | "test" | "stage" | "canary" | "prod"
  slug: string; // service slug, e.g. "gateway", "auth", "env-service"
  version: number; // API contract version, e.g. 1

  vars?: Record<string, unknown>; // bag of env-style key/value pairs

  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class EnvServiceDto extends DtoBase implements IDto {
  // ─────────────── Static: Collection & Index Hints ───────────────

  /** Hardwired collection for this DTO. Registry seeds instances with this once. */
  public static dbCollectionName(): string {
    return "env-service";
  }

  /**
   * Deterministic index hints consumed at boot by ensureIndexesForDtos().
   *
   * Invariants:
   * - Exactly one document per (env, slug, version).
   * - Fast lookup by env and slug.
   */
  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    // Uniqueness across the environment “dimension”
    { kind: "unique", fields: ["env", "slug", "version"] },

    // Common query paths
    { kind: "lookup", fields: ["slug"] },
    { kind: "lookup", fields: ["env"] },
  ];

  // ─────────────── Instance: Domain Fields ───────────────
  // IMPORTANT: Do NOT declare a public `id` field here — it would shadow DtoBase’s id/_id handling.

  /** Deployment environment, e.g. "dev", "test", "stage", "canary", "prod". */
  public env = "";

  /** Service slug, e.g. "gateway", "auth", "env-service". */
  public slug = "";

  /** Contract version, e.g. 1. */
  public version = 1;

  /**
   * Bag of environment-style key/value pairs.
   * Example keys:
   * - NV_MONGO_URI
   * - NV_MONGO_DB
   * - NV_MONGO_COLLECTION
   * - NV_COLLECTION_ENV_SERVICE_VALUES
   */
  private _vars: Record<string, string> = {};

  // ─────────────── Construction ───────────────

  /**
   * Accepts either the DtoBase secret (Registry path) OR meta (fromJson path).
   * This matches DtoBase’s `(secretOrArgs?: symbol | _DtoMeta)` contract.
   */
  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
  }

  // ─────────────── Wire hydration ───────────────

  /** Wire hydration (plug Zod/contract here when opts?.validate is true). */
  public static fromJson(
    json: unknown,
    opts?: { validate?: boolean }
  ): EnvServiceDto {
    const dto = new EnvServiceDto(DtoBase.getSecret());

    const j = (json ?? {}) as Partial<EnvServiceJson>;

    // id (optional, but if present must be valid via DtoBase)
    if (typeof j.id === "string" && j.id.trim()) {
      dto.setIdOnce(j.id.trim());
    }

    // required-ish core fields (we keep this minimal; ADR/contract will tighten)
    if (typeof j.env === "string") {
      dto.env = j.env.trim();
    }
    if (typeof j.slug === "string") {
      dto.slug = j.slug.trim();
    }

    if (typeof j.version === "number") {
      dto.version = Math.trunc(j.version);
    } else if (typeof (j as any).version === "string") {
      const n = Number((j as any).version);
      if (Number.isFinite(n) && n > 0) {
        dto.version = Math.trunc(n);
      }
    }

    // vars bag: normalize keys, stringify values
    if (j.vars && typeof j.vars === "object") {
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(j.vars)) {
        const key = k.trim();
        if (!key) continue;
        normalized[key] = String(v);
      }
      dto._vars = normalized;
    }

    // meta passthrough (DtoBase will normalize on toJson)
    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    // Light required-field check when validation is requested
    if (opts?.validate) {
      const issues: { path: string; code: string; message: string }[] = [];
      if (!dto.env) {
        issues.push({
          path: "env",
          code: "required",
          message: "env is required",
        });
      }
      if (!dto.slug) {
        issues.push({
          path: "slug",
          code: "required",
          message: "slug is required",
        });
      }
      if (!dto.version || dto.version <= 0) {
        issues.push({
          path: "version",
          code: "invalid",
          message: "version must be a positive integer",
        });
      }
      if (issues.length) {
        throw new DtoValidationError(
          `Invalid EnvServiceDto payload — ${issues.length} issue(s) found.`,
          issues
        );
      }
    }

    return dto;
  }

  // ─────────────── Outbound wire shape ───────────────

  /** Canonical outbound wire shape; DtoBase stamps meta here. */
  public toJson(): EnvServiceJson {
    const body: EnvServiceJson = {
      id: this.hasId() ? this._id : undefined,
      type: "env-service",

      env: this.env,
      slug: this.slug,
      version: this.version,

      vars: { ...this._vars },
    };

    return this._finalizeToJson(body);
  }

  /**
   * DTO-to-DTO patch helper for internal merges (no wire/json boundary).
   * Used by EnvConfigReader.mergeEnvBags() to merge service vars into root vars.
   *
   * Semantics:
   * - env/slug/version from `other` overwrite this instance when present.
   * - vars are merged key-wise: existing vars stay, `other` wins on conflicts.
   * - id/meta are NOT touched here (ID is immutable per ADR-0057).
   */
  public patchFrom(other: EnvServiceDto): this {
    if (other.env) {
      this.env = other.env;
    }

    if (other.slug) {
      this.slug = other.slug;
    }

    if (typeof other.version === "number" && other.version > 0) {
      this.version = Math.trunc(other.version);
    }

    const otherVars = other._vars;
    if (otherVars && Object.keys(otherVars).length > 0) {
      this._vars = {
        ...this._vars,
        ...otherVars,
      };
    }

    return this;
  }

  /**
   * Convenience alias for DTO-to-DTO patching.
   * Used by EnvConfigReader.mergeEnvBags() and other internal callers.
   */
  public patchFromDto(other: EnvServiceDto): this {
    return this.patchFrom(other);
  }

  // ─────────────── ADR-0044: Generic Key/Value API ───────────────

  public getEnvVar(name: string): string {
    const v = this._vars[name];
    if (v === undefined) {
      throw new Error(
        `ENV_VAR_MISSING: "${name}" is not defined for env="${this.env}", ` +
          `slug="${this.slug}", version=${this.version}. ` +
          "Ops: ensure env-service contains this key in the corresponding document."
      );
    }
    return v;
  }

  public tryEnvVar(name: string): string | undefined {
    return this._vars[name];
  }

  public hasEnvVar(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._vars, name);
  }

  public listEnvVars(): string[] {
    return Object.keys(this._vars).sort();
  }

  /** @deprecated — use getEnvVar(name). */
  public getVar(name: string): string {
    return this.getEnvVar(name);
  }

  /** @deprecated — use tryEnvVar(name). */
  public maybeVar(name: string): string | undefined {
    return this.tryEnvVar(name);
  }

  // ─────────────── IDto contract ───────────────

  public getType(): string {
    return "env-service";
  }

  public getId(): string {
    return this._id;
  }
}
