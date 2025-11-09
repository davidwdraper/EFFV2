// backend/services/shared/src/dto/env-service.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version@level)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *   - ADR-0053 (Instantiation discipline via DtoBase secret)
 *   - ADR-0057 (ID Generation & Validation — id is a string (UUIDv4 or 24-hex Mongo id); immutable; WARN on overwrite attempt)
 *
 * Purpose:
 * - Concrete DTO for env-service configuration records.
 * - Represents a single environment configuration document:
 *     • one document per (env, slug, version, level)
 *     • vars is a bag of env-style key/value pairs
 *
 * Notes:
 * - Instance collection is seeded by the Registry via setCollectionName().
 * - dbCollectionName() returns the hardwired collection for this DTO.
 * - indexHints declare deterministic indexes to be ensured at boot.
 * - ID lifecycle:
 *     • If wire provides id → DtoBase setter validates (UUIDv4 or 24-hex Mongo id) and stores normalized.
 *     • If absent → DbWriter will generate **before** calling toJson().
 *     • toJson() never invents or mutates id (no ID insertion during/after toJson).
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
  level?: string; // logical level, e.g. "service", "system"

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
   * - Exactly one document per (env, slug, version, level).
   * - Fast lookup by env and slug.
   */
  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    // Uniqueness across the environment “dimension”
    { kind: "unique", fields: ["env", "slug", "version", "level"] },

    // Common query paths
    { kind: "lookup", fields: ["slug"] },
    { kind: "lookup", fields: ["env"] },
  ];

  // ─────────────── Instance: Domain Fields ───────────────
  // IMPORTANT: Do NOT declare a public `id` field here — it would shadow DtoBase.id.

  /** Deployment environment, e.g. "dev", "test", "stage", "canary", "prod". */
  public env = "";

  /** Service slug, e.g. "gateway", "auth", "env-service". */
  public slug = "";

  /** Contract version, e.g. 1. */
  public version = 1;

  /**
   * Logical level of this config record, e.g.:
   * - "service" (per-service env vars)
   * - "system"  (global/system-level env vars)
   *
   * Left open as string; Zod/contract can enforce tighter enum.
   */
  public level = "service";

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
      dto.id = j.id.trim();
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

    if (typeof j.level === "string" && j.level.trim()) {
      dto.level = j.level.trim();
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
      id: this.hasId() ? this.id : undefined,
      type: "env-service",

      env: this.env,
      slug: this.slug,
      version: this.version,
      level: this.level,

      vars: { ...this._vars },
    };

    return this._finalizeToJson(body);
  }

  /** Optional patch helper used by update pipelines. */
  public patchFrom(json: Partial<EnvServiceJson>): this {
    if (json.env !== undefined && typeof json.env === "string") {
      this.env = json.env.trim();
    }

    if (json.slug !== undefined && typeof json.slug === "string") {
      this.slug = json.slug.trim();
    }

    if (json.version !== undefined) {
      const n =
        typeof json.version === "string" ? Number(json.version) : json.version;
      if (Number.isFinite(n) && n > 0) {
        this.version = Math.trunc(n as number);
      }
    }

    if (json.level !== undefined && typeof json.level === "string") {
      const lvl = json.level.trim();
      if (lvl) this.level = lvl;
    }

    if (json.vars !== undefined && json.vars && typeof json.vars === "object") {
      const incoming: Record<string, string> = {};
      for (const [k, v] of Object.entries(json.vars)) {
        const key = k.trim();
        if (!key) continue;
        incoming[key] = String(v);
      }
      this._vars = {
        ...this._vars,
        ...incoming,
      };
    }

    return this;
  }

  // ─────────────── ADR-0044: Generic Key/Value API ───────────────

  /**
   * Retrieve a required variable; throws if missing (no defaults).
   * Error includes env/slug/version/level for Ops correlation.
   */
  public getEnvVar(name: string): string {
    const v = this._vars[name];
    if (v === undefined) {
      throw new Error(
        `ENV_VAR_MISSING: "${name}" is not defined for env="${this.env}", ` +
          `slug="${this.slug}", version=${this.version}, level="${this.level}". ` +
          "Ops: ensure env-service contains this key in the corresponding document."
      );
    }
    return v;
  }

  /** Retrieve an optional variable (undefined if absent). */
  public tryEnvVar(name: string): string | undefined {
    return this._vars[name];
  }

  /** Predicate — does the key exist? */
  public hasEnvVar(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._vars, name);
  }

  /** List all available variable keys (copy, sorted for stability). */
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

  /** Canonical DTO type key (registry key). */
  public getType(): string {
    return "env-service";
  }

  /** Canonical DTO id. */
  public getId(): string {
    return this.id;
  }
}
