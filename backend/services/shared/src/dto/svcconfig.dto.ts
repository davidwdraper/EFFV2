// backend/services/shared/src/dto/svcconfig.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 *   - ADR-0053 (Instantiation discipline via BaseDto secret)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable; WARN on overwrite attempt)
 *
 * Purpose:
 * - Concrete DTO for the svcconfig service.
 * - Represents a single configuration slot for a given (env, slug, majorVersion).
 * - Provides the target connection info for gateway proxying and S2S calls.
 *   • baseUrl: full scheme://host:port used by SvcClient and internal callers.
 *   • targetPort: convenience for the gateway and other port-based logic.
 * - Encodes per-field access rules for admin-only mutation.
 *
 * Notes:
 * - We do **not** attempt to derive baseUrl from other fields at runtime:
 *   if a record is missing baseUrl, resolvers treat it as a misconfiguration
 *   and refuse to authorize calls using that entry.
 * - Admins can:
 *   • Disable a service via `isEnabled`.
 *   • Set a minimum UserType via `minUserType` (numeric, per UserType enum).
 *   • Control whether the service is a gateway or S2S target.
 * - ID lifecycle:
 *     • Wire always uses `_id` (UUIDv4 string, lowercase).
 *     • DbWriter generates id BEFORE toBody() when absent.
 *     • No legacy `id` tolerance — strictly `_id` on input/output.
 */

import { DtoBase, type DtoMeta, UserType } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";

// Wire-friendly shape
type SvcconfigJson = {
  _id?: string; // canonical wire id
  type?: "svcconfig";

  env?: string;
  slug?: string;
  majorVersion?: number;

  // Full scheme://host:port for S2S / worker calls.
  baseUrl?: string;

  // Convenience for gateway and any port-only logic.
  targetPort?: number;

  isGatewayTarget?: boolean;
  isS2STarget?: boolean;
  isEnabled?: boolean;
  minUserType?: number;

  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class SvcconfigDto extends DtoBase {
  /** Hardwired collection for this DTO. */
  public static dbCollectionName(): string {
    return "svcconfig";
  }

  /**
   * Per-field access rules.
   * - read: minimum UserType required to read via `readField()`.
   * - write: minimum UserType required to write via `writeField()`.
   *
   * NOTE:
   * - Missing rules are considered a hard error (see DtoBase.readField/writeField).
   */
  public static readonly access = {
    env: {
      read: UserType.Anon,
      write: UserType.AdminSystem,
    },
    slug: {
      read: UserType.Anon,
      write: UserType.AdminSystem,
    },
    majorVersion: {
      read: UserType.Anon,
      write: UserType.AdminDomain,
    },
    baseUrl: {
      read: UserType.Anon,
      write: UserType.AdminRoot,
    },
    targetPort: {
      read: UserType.Anon,
      write: UserType.AdminRoot,
    },
    isGatewayTarget: {
      read: UserType.Anon,
      write: UserType.AdminDomain,
    },
    isS2STarget: {
      read: UserType.Anon,
      write: UserType.AdminDomain,
    },
    isEnabled: {
      read: UserType.Anon,
      write: UserType.AdminDomain,
    },
    minUserType: {
      read: UserType.Anon,
      write: UserType.AdminDomain,
    },
  } as const;

  /**
   * Deterministic index hints consumed at boot by ensureIndexesForDtos().
   *
   * Business key:
   * - Unique per (env, slug, majorVersion).
   *
   * Lookups:
   * - env + slug            → fast resolution for specific service in env.
   * - env + isGatewayTarget → gateway mirror of all qualifying slugs in env.
   */
  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    {
      kind: "unique",
      fields: ["env", "slug", "majorVersion"],
      options: { name: "ux_svcconfig_env_slug_version" },
    },
    {
      kind: "lookup",
      fields: ["env", "slug"],
      options: { name: "ix_svcconfig_env_slug" },
    },
    {
      kind: "lookup",
      fields: ["env", "isGatewayTarget"],
      options: { name: "ix_svcconfig_env_gateway_target" },
    },
  ];

  // ─────────────── Private Domain Fields ───────────────
  // NOTE: These are accessed via readField/writeField by getters/setters.

  /** Environment key (e.g., "dev", "stg", "prod"). */
  private _env = "";

  /** Service slug (e.g., "gateway", "env-service", "svcconfig", "auth"). */
  private _slug = "";

  /** API major version used in URL path: `/api/<slug>/v<majorVersion>/...`. */
  private _majorVersion = 1;

  /**
   * Full base URL for worker/S2S calls, including scheme/host/port.
   * Example: "http://127.0.0.1:4040".
   */
  private _baseUrl = "";

  /**
   * Target service port. Gateway will proxy to this port; S2S callers may
   * also use it for diagnostics/ops, but the canonical S2S URL is `baseUrl`.
   */
  private _targetPort = 0;

  /** True if this service is exposed via gateway proxy for client traffic. */
  private _isGatewayTarget = false;

  /** True if this service may be looked up and used as a S2S target. */
  private _isS2STarget = true;

  /** True if this configuration slot is enabled. */
  private _isEnabled = true;

  /**
   * Minimum UserType required to access this service via the gateway layer.
   * Stored as numeric enum value (see UserType definition).
   */
  private _minUserType = UserType.Anon;

  public constructor(secretOrMeta?: symbol | DtoMeta) {
    super(secretOrMeta);
  }

  // ─────────────── Getters/Setters (Secure Access) ───────────────

  public get env(): string {
    return this.readField<string>("env");
  }

  public set env(value: string) {
    this.writeField("env", value);
  }

  public get slug(): string {
    return this.readField<string>("slug");
  }

  public set slug(value: string) {
    this.writeField("slug", value);
  }

  public get majorVersion(): number {
    return this.readField<number>("majorVersion");
  }

  public set majorVersion(value: number) {
    this.writeField("majorVersion", Math.trunc(value));
  }

  public get baseUrl(): string {
    return this.readField<string>("baseUrl");
  }

  public set baseUrl(value: string) {
    this.writeField("baseUrl", value.trim());
  }

  public get targetPort(): number {
    return this.readField<number>("targetPort");
  }

  public set targetPort(value: number) {
    this.writeField("targetPort", Math.trunc(value));
  }

  public get isGatewayTarget(): boolean {
    return this.readField<boolean>("isGatewayTarget");
  }

  public set isGatewayTarget(value: boolean) {
    this.writeField("isGatewayTarget", Boolean(value));
  }

  public get isS2STarget(): boolean {
    return this.readField<boolean>("isS2STarget");
  }

  public set isS2STarget(value: boolean) {
    this.writeField("isS2STarget", Boolean(value));
  }

  public get isEnabled(): boolean {
    return this.readField<boolean>("isEnabled");
  }

  public set isEnabled(value: boolean) {
    this.writeField("isEnabled", Boolean(value));
  }

  public get minUserType(): number {
    return this.readField<number>("minUserType");
  }

  public set minUserType(value: number) {
    this.writeField("minUserType", Math.trunc(value));
  }

  // ─────────────── Wire Hydration ───────────────

  /** Wire hydration (strict `_id` only). */
  public static fromBody(
    json: unknown,
    _opts?: { validate?: boolean }
  ): SvcconfigDto {
    const dto = new SvcconfigDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<SvcconfigJson>;

    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    // NOTE:
    // fromBody hydrates private fields directly; it is considered a trusted,
    // internal operation, not a user-level mutation path.
    if (typeof j.env === "string") dto._env = j.env;
    if (typeof j.slug === "string") dto._slug = j.slug;
    if (typeof j.majorVersion === "number") {
      dto._majorVersion = Math.trunc(j.majorVersion);
    }

    if (typeof j.baseUrl === "string") {
      dto._baseUrl = j.baseUrl.trim();
    }

    if (typeof j.targetPort === "number") {
      dto._targetPort = Math.trunc(j.targetPort);
    }

    if (typeof j.isGatewayTarget === "boolean") {
      dto._isGatewayTarget = j.isGatewayTarget;
    }
    if (typeof j.isS2STarget === "boolean") {
      dto._isS2STarget = j.isS2STarget;
    }
    if (typeof j.isEnabled === "boolean") {
      dto._isEnabled = j.isEnabled;
    }

    if (typeof j.minUserType === "number" && Number.isInteger(j.minUserType)) {
      dto._minUserType = j.minUserType;
    }

    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    // Any strict validation (required env/slug/majorVersion/baseUrl/targetPort)
    // should be enforced by the contract layer if/when you turn it on.
    return dto;
  }

  // ─────────────── Outbound Wire Shape ───────────────

  /** Canonical outbound wire shape; BaseDto stamps meta here. */
  public toBody(): SvcconfigJson {
    // DbWriter should ensure id BEFORE calling toBody().
    const body: SvcconfigJson = {
      _id: this._id,
      type: "svcconfig" as const,

      env: this._env,
      slug: this._slug,
      majorVersion: this._majorVersion,

      baseUrl: this._baseUrl,
      targetPort: this._targetPort,

      isGatewayTarget: this._isGatewayTarget,
      isS2STarget: this._isS2STarget,
      isEnabled: this._isEnabled,
      minUserType: this._minUserType,
    };

    return this._finalizeToJson(body);
  }

  // ─────────────── Patch Helper ───────────────

  /**
   * Patch helper used by update pipelines.
   * - Uses public setters, so field-level access rules apply.
   */
  public patchFrom(json: Partial<SvcconfigJson>): this {
    if (json.env !== undefined && typeof json.env === "string") {
      this.env = json.env;
    }
    if (json.slug !== undefined && typeof json.slug === "string") {
      this.slug = json.slug;
    }

    if (json.majorVersion !== undefined) {
      const n =
        typeof json.majorVersion === "string"
          ? Number(json.majorVersion)
          : json.majorVersion;
      if (Number.isFinite(n)) this.majorVersion = Math.trunc(n as number);
    }

    if (json.baseUrl !== undefined && typeof json.baseUrl === "string") {
      this.baseUrl = json.baseUrl;
    }

    if (json.targetPort !== undefined) {
      const n =
        typeof json.targetPort === "string"
          ? Number(json.targetPort)
          : json.targetPort;
      if (Number.isFinite(n)) this.targetPort = Math.trunc(n as number);
    }

    if (json.isGatewayTarget !== undefined) {
      this.isGatewayTarget = Boolean(json.isGatewayTarget);
    }
    if (json.isS2STarget !== undefined) {
      this.isS2STarget = Boolean(json.isS2STarget);
    }
    if (json.isEnabled !== undefined) {
      this.isEnabled = Boolean(json.isEnabled);
    }

    if (json.minUserType !== undefined) {
      const n =
        typeof json.minUserType === "string"
          ? Number(json.minUserType)
          : json.minUserType;
      if (Number.isInteger(n)) this.minUserType = n as number;
    }

    return this;
  }

  // ─────────────── IDto Contract Hook ───────────────

  public getType(): string {
    return "svcconfig";
  }
}
