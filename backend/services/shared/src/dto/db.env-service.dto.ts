// backend/services/shared/src/dto/db.env-service.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *   - ADR-0103 (DTO naming convention: keys, filenames, classnames)
 *   - ADR-0044 (DbEnvServiceDto — one doc per env@slug@version)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable)
 *   - ADR-0074 (DB_STATE-aware DB selection via getDbVar; _infra DBs state-invariant)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Concrete DB DTO for env-service configuration records.
 *
 * Naming (ADR-0103):
 * - File:  db.env-service.dto.ts
 * - Key:   db.env-service.dto
 * - Class: DbEnvServiceDto
 *
 * Construction (ADR-0102):
 * - Scenario A: new DbEnvServiceDto(secret) => MUST mint _id
 * - Scenario B: new DbEnvServiceDto(secret, { body }) => MUST require _id UUIDv4, MUST NOT mint
 *
 * Invariants:
 * - DTO must not read process.env (ADR-0080).
 * - Runtime config reads must come from vars + DTO identity.
 *
 * Var access semantics (ADR-0074):
 * - getEnvVar(name): required (string or throw)
 * - tryEnvVar(name): optional (string | undefined)
 * - getDbVar(name): required (string or throw)  ✅ DB_STATE-aware
 * - tryDbVar(name): optional (string | undefined) ✅ DB_STATE-aware when present
 */

import { DtoBase, type DtoCtorOpts } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";
import { validateUUIDString } from "../utils/uuid";
import { field, unwrapMetaEnvelope } from "./dsl";

export type EnvServiceJson = {
  _id?: string;
  type?: "env-service";

  env: string;
  slug: string;
  version: number;

  vars?: Record<string, unknown>;

  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export interface EnvServiceFieldOptions {
  validate?: boolean;
}

export const EnvServiceFields = {
  type: field.literal("env-service", {
    required: false,
    presentByDefault: true,
  }),

  env: field.string({
    required: true,
    minLen: 1,
    maxLen: 40,
    ui: { input: "text", promptKey: "envService.env" },
  }),

  slug: field.string({
    required: true,
    minLen: 1,
    maxLen: 80,
    ui: { input: "text", promptKey: "envService.slug" },
  }),

  version: field.number({
    required: true,
    ui: { input: "number", promptKey: "envService.version" },
  }),
} as const;

export class DbEnvServiceDto extends DtoBase {
  public static dbCollectionName(): string {
    return "env-service";
  }

  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    {
      kind: "unique",
      fields: ["env", "slug", "version"],
      options: { name: "ux_env_service_env_slug_version" },
    },
    {
      kind: "lookup",
      fields: ["env"],
      options: { name: "ix_env_service_env" },
    },
    {
      kind: "lookup",
      fields: ["slug"],
      options: { name: "ix_env_service_slug" },
    },
  ];

  private _env = "";
  private _slug = "";
  private _version = 1;

  private _vars: Record<string, string> = {};

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string },
    opts?: DtoCtorOpts
  ) {
    super(secretOrMeta);

    this.initCtor(opts, (body, h) => {
      this.hydrateFromBody(body, { validate: h.validate });
    });
  }

  /** ADR-0103: must match registry key. */
  public getDtoKey(): string {
    return "db.env-service.dto";
  }

  private hydrateFromBody(json: unknown, opts?: { validate?: boolean }): void {
    const unwrapped = unwrapMetaEnvelope(json);
    const j = (unwrapped ?? {}) as Partial<EnvServiceJson>;

    const rawId = typeof j._id === "string" ? j._id.trim() : "";
    if (!rawId) {
      throw new Error(
        "DTO_ID_MISSING: DbEnvServiceDto hydration requires '_id' (UUIDv4) on the inbound payload."
      );
    }

    this.setIdOnce(validateUUIDString(rawId));

    this.setEnv(j.env, { validate: opts?.validate });
    this.setSlug(j.slug, { validate: opts?.validate });
    this.setVersion(j.version, { validate: opts?.validate });

    this.setVars(j.vars);

    this.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    if (opts?.validate) {
      this.assertValidSelf();
    }
  }

  public get env(): string {
    return this._env;
  }

  public setEnv(value: unknown, opts?: EnvServiceFieldOptions): this {
    this._env = (value == null ? "" : String(value)).trim();
    if (opts?.validate && !this._env) {
      throw new Error("DbEnvServiceDto.env: field is required.");
    }
    return this;
  }

  public static fromBody(
    body: unknown,
    opts?: { validate?: boolean; mode?: "wire" | "db" }
  ): DbEnvServiceDto {
    // Use the registry secret via the base class helper (no direct secret import).
    return new DbEnvServiceDto(DtoBase.getSecret(), {
      body,
      validate: opts?.validate === true,
      mode: opts?.mode,
    });
  }

  public get slug(): string {
    return this._slug;
  }

  public setSlug(value: unknown, opts?: EnvServiceFieldOptions): this {
    this._slug = (value == null ? "" : String(value)).trim();
    if (opts?.validate && !this._slug) {
      throw new Error("DbEnvServiceDto.slug: field is required.");
    }
    return this;
  }

  public get version(): number {
    return this._version;
  }

  public setVersion(value: unknown, opts?: EnvServiceFieldOptions): this {
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string"
        ? Number(value.trim())
        : NaN;

    const v = Number.isFinite(n) ? Math.trunc(n) : 0;

    if (opts?.validate && (!v || v <= 0)) {
      throw new Error("DbEnvServiceDto.version: must be a positive integer.");
    }

    if (v > 0) this._version = v;
    return this;
  }

  public getVarsRaw(): Record<string, string> {
    return { ...this._vars };
  }

  public setVars(value: unknown): this {
    if (value === undefined || value === null || typeof value !== "object") {
      this._vars = {};
      return this;
    }

    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = (k ?? "").trim();
      if (!key) continue;
      normalized[key] = v == null ? "" : String(v);
    }

    this._vars = normalized;
    return this;
  }

  public toBody(): EnvServiceJson {
    const body: EnvServiceJson = {
      _id: this.getId(),
      type: "env-service",

      env: this._env,
      slug: this._slug,
      version: this._version,

      vars: { ...this._vars },
    };

    return this._finalizeToJson(body);
  }

  public patchFrom(
    json: Partial<EnvServiceJson>,
    opts?: { validate?: boolean }
  ): this {
    if (json.env !== undefined)
      this.setEnv(json.env, { validate: opts?.validate });
    if (json.slug !== undefined)
      this.setSlug(json.slug, { validate: opts?.validate });
    if (json.version !== undefined)
      this.setVersion(json.version, { validate: opts?.validate });
    if (json.vars !== undefined) this.setVars(json.vars);
    return this;
  }

  /**
   * DTO-to-DTO patch helper for internal merges (no wire/json boundary).
   * Used by EnvConfigReader.mergeEnvBags() to merge service vars into root vars.
   *
   * Semantics (env-service contract):
   * - ONLY vars are merged key-wise.
   * - Existing vars stay; `other` wins on conflicts; new keys are added.
   * - env/slug/version are NOT modified here (root identity must remain "service-root").
   * - id/meta are NOT touched here (ID is immutable per ADR-0057).
   */
  public patchFromDto(other: DbEnvServiceDto): this {
    const otherVars = other?.getVarsRaw?.() ?? {};
    if (otherVars && Object.keys(otherVars).length > 0) {
      this._vars = {
        ...this._vars,
        ...otherVars,
      };
    }
    return this;
  }

  // ───────────────────────────────────────────────────────────────
  // ADR-0074: DB_STATE-aware DB selection via getDbVar()
  // ───────────────────────────────────────────────────────────────

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
    return DbEnvServiceDto.dbKeys.has(name);
  }

  private resolveDbState(): string {
    const value = (this._vars[DbEnvServiceDto.dbStateKey] ?? "").trim();
    if (!value) {
      throw new Error(
        `ENV_DBSTATE_MISSING: DB_STATE is not defined in vars for env="${this._env}", ` +
          `slug="${this._slug}", version=${this._version}. ` +
          'Ops: set "DB_STATE" in the env-service config record vars for this document.'
      );
    }
    return value;
  }

  private decorateDbName(base: string): string {
    const trimmed = (base ?? "").trim();
    if (!trimmed) {
      throw new Error(
        `ENV_DBNAME_INVALID: NV_MONGO_DB is empty for env="${this._env}", ` +
          `slug="${this._slug}", version=${this._version}. ` +
          "Ops: set NV_MONGO_DB to a non-empty base name (e.g., 'nv', 'nv_env_infra')."
      );
    }

    if (trimmed.toLowerCase().endsWith("_infra")) {
      return trimmed;
    }

    const state = this.resolveDbState();
    return `${trimmed}_${state}`;
  }

  public getEnvVar(name: string): string {
    if (this.isDbKey(name)) {
      throw new Error(
        `ENV_DBVAR_USE_GETDBVAR: "${name}" is DB-related and must be accessed via getDbVar("${name}"). ` +
          `Context: env="${this._env}", slug="${this._slug}", version=${this._version}.`
      );
    }

    const v = this._vars[name];
    if (v === undefined) {
      throw new Error(
        `ENV_VAR_MISSING: "${name}" is not defined for env="${this._env}", ` +
          `slug="${this._slug}", version=${this._version}. ` +
          "Ops: ensure env-service contains this key in the corresponding document."
      );
    }
    return v.trim();
  }

  public tryEnvVar(name: string): string | undefined {
    if (this.isDbKey(name)) {
      throw new Error(
        `ENV_DBVAR_USE_GETDBVAR: "${name}" is DB-related and must be accessed via getDbVar("${name}"). ` +
          `Context: env="${this._env}", slug="${this._slug}", version=${this._version}.`
      );
    }
    const v = this._vars[name];
    return v === undefined ? undefined : v.trim();
  }

  public hasEnvVar(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._vars, name);
  }

  public listEnvVars(): string[] {
    return Object.keys(this._vars).sort();
  }

  /**
   * Required DB var accessor (ADR-0074).
   * Returns string (DB_STATE-aware for NV_MONGO_DB) or throws if missing/empty.
   */
  public getDbVar(name: string): string {
    if (!this.isDbKey(name)) {
      throw new Error(
        `ENV_DBVAR_NON_DB_KEY: "${name}" is not registered as a DB-related key. ` +
          "Ops: use getEnvVar() for non-DB keys, or extend DbEnvServiceDto.dbKeys if this is truly DB-related."
      );
    }

    const raw = this._vars[name];
    if (raw === undefined || raw === null || `${raw}`.trim() === "") {
      throw new Error(
        `ENV_DBVAR_MISSING: "${name}" is not defined or empty for env="${this._env}", ` +
          `slug="${this._slug}", version=${this._version}. ` +
          "Ops: ensure this DB config key exists and holds a non-empty value in env-service."
      );
    }

    const value = `${raw}`.trim();

    if (name === "NV_MONGO_DB") {
      return this.decorateDbName(value).trim();
    }

    return value;
  }

  /**
   * Optional DB var accessor (ADR-0074).
   * Returns string | undefined (DB_STATE-aware for NV_MONGO_DB when present).
   */
  public tryDbVar(name: string): string | undefined {
    if (!this.isDbKey(name)) {
      throw new Error(
        `ENV_DBVAR_NON_DB_KEY: "${name}" is not registered as a DB-related key. ` +
          "Ops: use tryEnvVar() for non-DB keys, or extend DbEnvServiceDto.dbKeys if this is truly DB-related."
      );
    }

    const raw = this._vars[name];
    if (raw === undefined || raw === null || `${raw}`.trim() === "") {
      return undefined;
    }

    const value = `${raw}`.trim();

    if (name === "NV_MONGO_DB") {
      return this.decorateDbName(value).trim();
    }

    return value;
  }

  public getResolvedDbName(): string {
    return this.getDbVar("NV_MONGO_DB").trim();
  }

  public getEnvLabel(): string {
    return this._env.trim();
  }

  private assertValidSelf(): void {
    const issues: { path: string; code: string; message: string }[] = [];

    if (!this._env)
      issues.push({
        path: "env",
        code: "required",
        message: "env is required",
      });
    if (!this._slug)
      issues.push({
        path: "slug",
        code: "required",
        message: "slug is required",
      });
    if (!this._version || this._version <= 0) {
      issues.push({
        path: "version",
        code: "invalid",
        message: "version must be a positive integer",
      });
    }

    if (issues.length) {
      throw new Error(
        `DTO_VALIDATION_ERROR: DbEnvServiceDto invalid payload — ${issues.length} issue(s): ` +
          JSON.stringify(issues)
      );
    }
  }
}
