// backend/services/shared/src/dto/svcenv.dto.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Strict DTO for non-secret environment configuration keyed by env@slug@version.
 * - Validates, normalizes, and encapsulates all environment variables.
 *
 * Rules:
 * - Data enters via fromJson(), exits via toJson().
 * - No field exposure, no logging, no "all()" snapshots.
 * - Validation errors aggregated and thrown as DtoValidationError.
 * - Generic access only (getEnvVar/tryEnvVar/hasEnvVar/listEnvVars). No DTO-specific getters.
 */

import { z } from "zod";
import { BaseDto, DtoValidationError } from "./DtoBase";

/** Internal validation schema (not exported). */
const SvcEnvWireSchema = z.object({
  ok: z.boolean().optional(),
  key: z.string().min(3),
  vars: z.record(z.string(), z.string()),
  etag: z.string().optional(),

  // optional metadata passthrough
  slug: z.string().optional(),
  env: z.string().optional(),
  version: z.number().int().positive().optional(),
  updatedAt: z.string().optional(),
  updatedByUserId: z.string().optional(),
  notes: z.string().optional(),
});

/** Exported type for serialization only. */
export type SvcEnvWire = z.infer<typeof SvcEnvWireSchema>;

export class SvcEnvDto extends BaseDto {
  private readonly _key: string;
  private readonly _varsObj: Record<string, string>;
  private readonly _varsMap: Map<string, string>;
  private readonly _etag?: string;

  private readonly _slug?: string;
  private readonly _env?: string;
  private readonly _version?: number;
  private readonly _updatedAt?: string;
  private readonly _updatedByUserId?: string;
  private readonly _notes?: string;

  private constructor(parsed: SvcEnvWire) {
    super();
    this._key = parsed.key;
    this._varsObj = parsed.vars;
    this._varsMap = new Map(Object.entries(parsed.vars));
    this._etag = parsed.etag;
    this._slug = parsed.slug;
    this._env = parsed.env;
    this._version = parsed.version;
    this._updatedAt = parsed.updatedAt;
    this._updatedByUserId = parsed.updatedByUserId;
    this._notes = parsed.notes;
  }

  /** Validate JSON, normalize, and return DTO. Throws DtoValidationError on failure. */
  public static override fromJson(json: unknown): SvcEnvDto {
    const result = SvcEnvWireSchema.safeParse(json);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message,
      }));
      throw new DtoValidationError(
        `Invalid SvcEnvDto payload — ${issues.length} issue(s) found.`,
        issues
      );
    }

    const parsed = result.data;

    // Normalize keys (no coercion of values)
    const normalizedVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.vars)) {
      const key = k.trim();
      if (!key) continue;
      normalizedVars[key] = v;
    }

    return new SvcEnvDto({
      ...parsed,
      key: parsed.key.trim(),
      vars: normalizedVars,
    });
  }

  /** Canonical outbound JSON (wire or persistence). */
  public override toJson(): SvcEnvWire {
    return {
      key: this._key,
      vars: { ...this._varsObj },
      etag: this._etag,
      slug: this._slug,
      env: this._env,
      version: this._version,
      updatedAt: this._updatedAt,
      updatedByUserId: this._updatedByUserId,
      notes: this._notes,
    };
  }

  // ==== Metadata (read-only) ====
  get key(): string {
    return this._key;
  }
  get etag(): string | undefined {
    return this._etag;
  }
  get slug(): string | undefined {
    return this._slug;
  }
  get env(): string | undefined {
    return this._env;
  }
  get version(): number | undefined {
    return this._version;
  }
  get updatedAt(): string | undefined {
    return this._updatedAt;
  }
  get updatedByUserId(): string | undefined {
    return this._updatedByUserId;
  }
  get notes(): string | undefined {
    return this._notes;
  }

  // ==== ADR-0044: Generic Key/Value API ====

  /**
   * Retrieve a required variable; throws if missing (no defaults).
   * Error includes key, svcenv key, and etag for Ops correlation.
   */
  public getEnvVar(name: string): string {
    const v = this._varsMap.get(name);
    if (v === undefined) {
      const base = `Missing required env var "${name}" in svcenv key="${this._key}"`;
      const et = this._etag ? ` (etag=${this._etag})` : "";
      throw new Error(
        `${base}${et}. Ops: ensure svcenv document includes this key and the service has permission to read it.`
      );
    }
    return v;
  }

  /** Retrieve an optional variable (undefined if absent). */
  public tryEnvVar(name: string): string | undefined {
    return this._varsMap.get(name);
  }

  /** Predicate — does the key exist? */
  public hasEnvVar(name: string): boolean {
    return this._varsMap.has(name);
  }

  /** List all available variable keys (copy). */
  public listEnvVars(): string[] {
    return Array.from(this._varsMap.keys());
  }

  // ==== Temporary aliases (migration aid) ====
  /** @deprecated — use getEnvVar(name). */
  public getVar(name: string): string {
    return this.getEnvVar(name);
  }
  /** @deprecated — use tryEnvVar(name). */
  public maybeVar(name: string): string | undefined {
    return this.tryEnvVar(name);
  }
}
