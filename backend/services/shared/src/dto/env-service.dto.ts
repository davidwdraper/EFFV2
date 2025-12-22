// backend/services/shared/src/dto/env-service.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="_id")
 *   - ADR-0053 (Instantiation discipline via DtoBase secret)
 *   - ADR-0057 (ID Generation & Validation — id is a string (UUIDv4 or 24-hex Mongo id); immutable; WARN on overwrite attempt)
 *   - ADR-0074 (DB_STATE-aware DB selection via getDbVar; _infra DBs state-invariant)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Concrete DTO for env-service configuration records.
 * - Represents a single environment configuration document:
 *     • one document per (env, slug, version)
 *     • vars is a bag of env-style key/value pairs
 * - Also acts as the canonical adapter for DB_STATE-aware DB configuration:
 *     • Non-DB vars are accessed via getEnvVar()/tryEnvVar().
 *     • DB vars are accessed via getDbVar(), which applies DB_STATE rules.
 *
 * Invariants:
 * - DTO must not read process.env (ADR-0080). Bootstraps may read process.env,
 *   but runtime reads must come from vars and/or SvcSandbox identity.
 */

import { DtoBase, DtoValidationError } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";
import type { IDto } from "./IDto";

// Wire-friendly shape (for clarity)
type EnvServiceJson = {
  _id?: string; // canonical id (wire)
  type?: "env-service"; // dtoType (wire)

  env: string;
  slug: string;
  version: number;

  vars?: Record<string, unknown>;

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
    { kind: "unique", fields: ["env", "slug", "version"] },
    { kind: "lookup", fields: ["slug"] },
    { kind: "lookup", fields: ["env"] },
  ];

  // ─────────────── Instance: Domain Fields ───────────────

  /** Deployment environment, e.g. "dev", "test", "stage", "canary", "prod". */
  public env = "";

  /** Service slug, e.g. "gateway", "auth", "env-service". */
  public slug = "";

  /** Contract version, e.g. 1. */
  public version = 1;

  /** Bag of environment-style key/value pairs. Values are stored as strings. */
  private _vars: Record<string, string> = {};

  // ─────────────── Construction ───────────────

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);

    // Ensure every EnvServiceDto instance is collection-aware, even if it is
    // instantiated outside the Registry helpers (e.g., clone pipelines).
    this.setCollectionName(EnvServiceDto.dbCollectionName());
  }

  // ─────────────── Wire hydration ───────────────

  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): EnvServiceDto {
    const dto = new EnvServiceDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<EnvServiceJson>;

    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    if (typeof j.env === "string") dto.env = j.env.trim();
    if (typeof j.slug === "string") dto.slug = j.slug.trim();

    if (typeof j.version === "number") {
      dto.version = Math.trunc(j.version);
    } else if (typeof (j as any).version === "string") {
      const n = Number((j as any).version);
      if (Number.isFinite(n) && n > 0) dto.version = Math.trunc(n);
    }

    if (j.vars && typeof j.vars === "object") {
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(j.vars)) {
        const key = (k ?? "").trim();
        if (!key) continue;
        normalized[key] = String(v);
      }
      dto._vars = normalized;
    }

    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    if (opts?.validate) {
      const issues: { path: string; code: string; message: string }[] = [];
      if (!dto.env)
        issues.push({
          path: "env",
          code: "required",
          message: "env is required",
        });
      if (!dto.slug)
        issues.push({
          path: "slug",
          code: "required",
          message: "slug is required",
        });
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

  public toBody(): EnvServiceJson {
    const body: EnvServiceJson = {
      _id: this.hasId() ? this.getId() : undefined,
      type: "env-service",
      env: this.env,
      slug: this.slug,
      version: this.version,
      vars: { ...this._vars },
    };

    return this._finalizeToJson(body);
  }

  // ─────────────── Vars (raw + guarded accessors) ───────────────

  /**
   * Raw vars accessor (internal-only).
   *
   * Invariants:
   * - Defensive copy; callers cannot mutate DTO internals.
   * - Used for runtime composition (e.g., entrypoint builds SvcSandbox vars map).
   */
  public getVarsRaw(): Record<string, string> {
    return { ...this._vars };
  }

  // ─────────────── Patch helpers ───────────────

  public patchFrom(other: EnvServiceDto): this {
    if (other.env) this.env = other.env;
    if (other.slug) this.slug = other.slug;
    if (typeof other.version === "number" && other.version > 0) {
      this.version = Math.trunc(other.version);
    }

    const otherVars = other._vars;
    if (otherVars && Object.keys(otherVars).length > 0) {
      this._vars = { ...this._vars, ...otherVars };
    }

    return this;
  }

  public patchFromDto(other: EnvServiceDto): this {
    return this.patchFrom(other);
  }

  // ─────────────── Internal helpers: DB_STATE semantics ───────────────

  /** Keys that are considered DB-related and must go through getDbVar(). */
  private static readonly dbKeys: ReadonlySet<string> = new Set([
    "NV_MONGO_URI",
    "NV_MONGO_DB",
    "NV_MONGO_COLLECTION",
    "NV_MONGO_USER",
    "NV_MONGO_PASS",
    "NV_MONGO_OPTIONS",
  ]);

  private static readonly dbStateKey = "DB_STATE";

  private isDbKey(name: string): boolean {
    return EnvServiceDto.dbKeys.has(name);
  }

  /**
   * Resolve DB_STATE from vars only (no process.env fallback).
   *
   * Note:
   * - env-service bootstraps (pre-runtime) may read DB_STATE from process.env,
   *   but runtime DTO reads must be deterministic and explicit.
   */
  private resolveDbState(): string {
    const value = (this._vars[EnvServiceDto.dbStateKey] ?? "").trim();
    if (!value) {
      throw new Error(
        `ENV_DBSTATE_MISSING: DB_STATE is not defined in vars for env="${this.env}", ` +
          `slug="${this.slug}", version=${this.version}. ` +
          'Ops: set "DB_STATE" in the env-service config record vars for this document.'
      );
    }
    return value;
  }

  private decorateDbName(base: string): string {
    const trimmed = (base ?? "").trim();
    if (!trimmed) {
      throw new Error(
        `ENV_DBNAME_INVALID: NV_MONGO_DB is empty for env="${this.env}", ` +
          `slug="${this.slug}", version=${this.version}. ` +
          "Ops: set NV_MONGO_DB to a non-empty base name (e.g., 'nv', 'nv_env_infra')."
      );
    }

    if (trimmed.toLowerCase().endsWith("_infra")) {
      return trimmed;
    }

    const state = this.resolveDbState();
    return `${trimmed}_${state}`;
  }

  // ─────────────── ADR-0044/0074: Key/Value + DB-aware API ───────────────

  public getEnvVar(name: string): string {
    if (this.isDbKey(name)) {
      throw new Error(
        `ENV_DBVAR_USE_GETDBVAR: "${name}" is DB-related and must be accessed via getDbVar("${name}"). ` +
          `Context: env="${this.env}", slug="${this.slug}", version=${this.version}.`
      );
    }

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
    if (this.isDbKey(name)) {
      throw new Error(
        `ENV_DBVAR_USE_GETDBVAR: "${name}" is DB-related and must be accessed via getDbVar("${name}"). ` +
          `Context: env="${this.env}", slug="${this.slug}", version=${this.version}.`
      );
    }
    return this._vars[name];
  }

  public hasEnvVar(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._vars, name);
  }

  public listEnvVars(): string[] {
    return Object.keys(this._vars).sort();
  }

  public getDbVar(
    name: string,
    opts?: { required?: boolean }
  ): string | undefined {
    const required = opts?.required !== false;

    if (!this.isDbKey(name)) {
      throw new Error(
        `ENV_DBVAR_NON_DB_KEY: "${name}" is not registered as a DB-related key. ` +
          "Ops: use getEnvVar() for non-DB keys, or extend EnvServiceDto.dbKeys if this is truly DB-related."
      );
    }

    const raw = this._vars[name];
    if (raw === undefined || raw === null || `${raw}`.trim() === "") {
      if (!required) return undefined;
      throw new Error(
        `ENV_DBVAR_MISSING: "${name}" is not defined or empty for env="${this.env}", ` +
          `slug="${this.slug}", version=${this.version}. ` +
          "Ops: ensure this DB config key exists and holds a non-empty value in env-service."
      );
    }

    const value = `${raw}`.trim();

    if (name === "NV_MONGO_DB") {
      return this.decorateDbName(value);
    }

    return value;
  }

  public getResolvedDbName(): string {
    const name = this.getDbVar("NV_MONGO_DB");
    if (!name) {
      throw new Error(
        `ENV_DBNAME_MISSING: NV_MONGO_DB could not be resolved for env="${this.env}", ` +
          `slug="${this.slug}", version=${this.version}. ` +
          "Ops: ensure NV_MONGO_DB and DB_STATE are configured correctly."
      );
    }
    return name;
  }

  /** @deprecated — use getEnvVar(name) for non-DB keys or getDbVar(name) for DB keys. */
  public getVar(name: string): string {
    return this.getEnvVar(name);
  }

  /** @deprecated — use tryEnvVar(name) for non-DB keys or getDbVar(name, { required:false }) for DB keys. */
  public maybeVar(name: string): string | undefined {
    return this.tryEnvVar(name);
  }

  public getEnvLabel(): string {
    return this.env;
  }

  public getType(): string {
    return "env-service";
  }
}
