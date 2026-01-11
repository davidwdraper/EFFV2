// backend/services/shared/src/dto/db.svcconfig.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 *   - ADR-0053 (Instantiation discipline via BaseDto secret)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable; WARN on overwrite attempt)
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *
 * Purpose:
 * - Concrete DTO for the svcconfig service.
 * - Represents a single configuration slot for a given (env, slug, majorVersion).
 * - Provides the target connection info for gateway proxying and S2S calls.
 *
 * Notes:
 * - This DTO previously relied on DtoBase.readField/writeField for access rules.
 *   That API is gone, so access rules remain as static metadata only (for future
 *   gates), while this DTO now uses standard private-field setters/getters.
 *
 * Construction (ADR-0102):
 * - Scenario A: new DbSvcconfigDto(secret) => MUST mint _id (handled by DtoBase)
 * - Scenario B: new DbSvcconfigDto(secret, { body }) => MUST require _id UUIDv4, MUST NOT mint
 */

import { DtoBase, type DtoCtorOpts, type DtoMeta } from "./DtoBase";
import { UserType } from "../../../packages/dto/core/UserType";
import type { IndexHint } from "../../../packages/dto/core/index-hints";
import { validateUUIDString } from "../../../packages/dto/core/utils/uuid";
import { unwrapMetaEnvelope } from "../../../packages/core/dsl";

// Wire-friendly shape
export type SvcconfigJson = {
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

export class DbSvcconfigDto extends DtoBase {
  /** Hardwired collection for this DTO. */
  public static dbCollectionName(): string {
    return "svcconfig";
  }
  public getDtoKey(): string {
    return "db.svcconfig.dto";
  }
  /**
   * Per-field access rules.
   * NOTE:
   * - Kept as metadata only (legacy readField/writeField removed from DtoBase).
   */
  public static readonly access = {
    env: { read: UserType.Anon, write: UserType.AdminSystem },
    slug: { read: UserType.Anon, write: UserType.AdminSystem },
    majorVersion: { read: UserType.Anon, write: UserType.AdminDomain },
    baseUrl: { read: UserType.Anon, write: UserType.AdminRoot },
    targetPort: { read: UserType.Anon, write: UserType.AdminRoot },
    isGatewayTarget: { read: UserType.Anon, write: UserType.AdminDomain },
    isS2STarget: { read: UserType.Anon, write: UserType.AdminDomain },
    isEnabled: { read: UserType.Anon, write: UserType.AdminDomain },
    minUserType: { read: UserType.Anon, write: UserType.AdminDomain },
  } as const;

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

  private _env = "";
  private _slug = "";
  private _majorVersion = 1;

  private _baseUrl = "";
  private _targetPort = 0;

  private _isGatewayTarget = false;
  private _isS2STarget = true;
  private _isEnabled = true;

  private _minUserType = UserType.Anon;

  public constructor(secretOrMeta?: symbol | DtoMeta, opts?: DtoCtorOpts) {
    super(secretOrMeta);

    this.initCtor(opts, (body, h) => {
      this.hydrateFromBody(body, { validate: h.validate });
    });
  }

  // ─────────────── Getters / Setters ───────────────

  public get env(): string {
    return this._env;
  }
  public set env(value: string) {
    this._env = (value ?? "").trim();
  }

  public get slug(): string {
    return this._slug;
  }
  public set slug(value: string) {
    this._slug = (value ?? "").trim();
  }

  public get majorVersion(): number {
    return this._majorVersion;
  }
  public set majorVersion(value: number) {
    const n = Math.trunc(Number(value));
    this._majorVersion = Number.isFinite(n) && n > 0 ? n : 1;
  }

  public get baseUrl(): string {
    return this._baseUrl;
  }
  public set baseUrl(value: string) {
    this._baseUrl = (value ?? "").trim();
  }

  public get targetPort(): number {
    return this._targetPort;
  }
  public set targetPort(value: number) {
    const n = Math.trunc(Number(value));
    this._targetPort = Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  public get isGatewayTarget(): boolean {
    return this._isGatewayTarget;
  }
  public set isGatewayTarget(value: boolean) {
    this._isGatewayTarget = !!value;
  }

  public get isS2STarget(): boolean {
    return this._isS2STarget;
  }
  public set isS2STarget(value: boolean) {
    this._isS2STarget = !!value;
  }

  public get isEnabled(): boolean {
    return this._isEnabled;
  }
  public set isEnabled(value: boolean) {
    this._isEnabled = !!value;
  }

  public get minUserType(): number {
    return this._minUserType;
  }
  public set minUserType(value: number) {
    const n = Math.trunc(Number(value));
    this._minUserType = Number.isFinite(n) ? n : UserType.Anon;
  }

  // ─────────────── Hydration ───────────────

  private hydrateFromBody(json: unknown, opts?: { validate?: boolean }): void {
    const unwrapped = unwrapMetaEnvelope(json);
    const j = (unwrapped ?? {}) as Partial<SvcconfigJson>;

    const rawId = typeof j._id === "string" ? j._id.trim() : "";
    if (!rawId) {
      throw new Error(
        "DTO_ID_MISSING: DbSvcconfigDto hydration requires '_id' (UUIDv4) on the inbound payload."
      );
    }
    this.setIdOnce(validateUUIDString(rawId));

    if (typeof j.env === "string") this._env = j.env.trim();
    if (typeof j.slug === "string") this._slug = j.slug.trim();

    if (typeof j.majorVersion === "number") {
      this.majorVersion = j.majorVersion;
    }

    if (typeof j.baseUrl === "string") this._baseUrl = j.baseUrl.trim();
    if (typeof j.targetPort === "number") this.targetPort = j.targetPort;

    if (typeof j.isGatewayTarget === "boolean")
      this._isGatewayTarget = j.isGatewayTarget;
    if (typeof j.isS2STarget === "boolean") this._isS2STarget = j.isS2STarget;
    if (typeof j.isEnabled === "boolean") this._isEnabled = j.isEnabled;

    if (typeof j.minUserType === "number" && Number.isFinite(j.minUserType)) {
      this._minUserType = Math.trunc(j.minUserType);
    }

    this.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    if (opts?.validate) {
      if (!this._env) throw new Error("DbSvcconfigDto.env: field is required.");
      if (!this._slug)
        throw new Error("DbSvcconfigDto.slug: field is required.");
      if (!this._majorVersion || this._majorVersion <= 0) {
        throw new Error(
          "DbSvcconfigDto.majorVersion: must be a positive integer."
        );
      }
      if (!this._baseUrl) {
        throw new Error("DbSvcconfigDto.baseUrl: field is required.");
      }
      if (!Number.isFinite(this._targetPort) || this._targetPort <= 0) {
        throw new Error(
          "DbSvcconfigDto.targetPort: must be a positive integer."
        );
      }
    }
  }

  /** Wire hydration (strict `_id` only). */
  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): DbSvcconfigDto {
    return new DbSvcconfigDto(DtoBase.getSecret(), {
      body: json,
      validate: opts?.validate === true,
    });
  }

  // ─────────────── Outbound Wire Shape ───────────────

  public toBody(): SvcconfigJson {
    const body: SvcconfigJson = {
      _id: this.getId(),
      type: "svcconfig",

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

  public patchFrom(json: Partial<SvcconfigJson>): this {
    if (json.env !== undefined && typeof json.env === "string")
      this.env = json.env;
    if (json.slug !== undefined && typeof json.slug === "string")
      this.slug = json.slug;

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

    if (json.isGatewayTarget !== undefined)
      this.isGatewayTarget = !!json.isGatewayTarget;
    if (json.isS2STarget !== undefined) this.isS2STarget = !!json.isS2STarget;
    if (json.isEnabled !== undefined) this.isEnabled = !!json.isEnabled;

    if (json.minUserType !== undefined) {
      const n =
        typeof json.minUserType === "string"
          ? Number(json.minUserType)
          : json.minUserType;
      if (Number.isFinite(n)) this.minUserType = Math.trunc(n as number);
    }

    return this;
  }

  public getType(): string {
    return "svcconfig";
  }
}
