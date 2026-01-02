// backend/services/shared/src/dto/user-auth.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 *   - ADR-0053 (Instantiation discipline via BaseDto secret)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable; WARN on overwrite attempt)
 *   - ADR-0089 (DTO Field DSL with Meta Envelope)
 *   - ADR-0090 (DTO Field DSL Design + Non-Breaking Integration)
 *   - ADR-0092 (DTO Fields DSL + Testdata Generation)
 *
 * Purpose:
 * - Concrete DTO for persisted user authentication credentials ("user-auth" record).
 * - Stores ONLY opaque, hashed credential data — never cleartext secrets.
 */

import { DtoBase } from "./DtoBase";
import { UserType } from "./UserType";
import type { IndexHint } from "./persistence/index-hints";
import { field, unwrapMetaEnvelope } from "./dsl";

export type UserAuthJson = {
  _id?: string;
  type?: "user-auth";

  userId: string;

  hash: string;
  hashAlgo: string;
  hashParamsJson?: string;

  failedAttemptCount: number;
  lastFailedAt?: string;
  lockedUntil?: string;

  passwordCreatedAt: string;
  passwordUpdatedAt?: string;

  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
  ownerUserId?: string;
};

export interface UserAuthFieldOptions {
  validate?: boolean;
}

/**
 * DTO Field DSL (v1).
 * - Purely metadata/tooling hints; does not affect toBody()/persistence/S2S.
 * - Prompt keys are stable identities only.
 */
export const UserAuthFields = {
  type: field.literal("user-auth", { required: false, presentByDefault: true }),

  userId: field.string({
    required: true,
    minLen: 1,
    maxLen: 80,
    ui: { input: "text", promptKey: "userAuth.userId" },
  }),

  hash: field.string({
    required: true,
    minLen: 1,
    maxLen: 4000,
    ui: { input: "text", promptKey: "userAuth.hash" },
  }),

  hashAlgo: field.string({
    required: true,
    minLen: 2,
    maxLen: 40,
    ui: { input: "text", promptKey: "userAuth.hashAlgo" },
  }),

  hashParamsJson: field.string({
    required: false,
    presentByDefault: false,
    maxLen: 8000,
    format: "json",
    ui: { input: "textarea", promptKey: "userAuth.hashParamsJson" },
  }),

  failedAttemptCount: field.number({
    required: true,
    min: 0,
    max: 999999,
  }),

  lastFailedAt: field.string({
    required: false,
    presentByDefault: false,
    format: "isoTime",
  }),

  lockedUntil: field.string({
    required: false,
    presentByDefault: false,
    format: "isoTime",
  }),

  passwordCreatedAt: field.string({
    required: true,
    format: "isoTime",
  }),

  passwordUpdatedAt: field.string({
    required: false,
    presentByDefault: false,
    format: "isoTime",
  }),
} as const;

export class UserAuthDto extends DtoBase {
  public static dbCollectionName(): string {
    return "user-auth";
  }

  public static readonly access = {
    userId: { read: UserType.AdminSystem, write: UserType.AdminSystem },
    hash: { read: UserType.AdminSystem, write: UserType.AdminSystem },
    hashAlgo: { read: UserType.AdminSystem, write: UserType.AdminSystem },
    hashParamsJson: { read: UserType.AdminSystem, write: UserType.AdminSystem },
    failedAttemptCount: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
    lastFailedAt: { read: UserType.AdminSystem, write: UserType.AdminSystem },
    lockedUntil: { read: UserType.AdminSystem, write: UserType.AdminSystem },
    passwordCreatedAt: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
    passwordUpdatedAt: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
  } as const;

  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    {
      kind: "unique",
      fields: ["userId"],
      options: { name: "ux_user-auth_userId" },
    },
    {
      kind: "lookup",
      fields: ["userId"],
      options: { name: "ix_user-auth_userId" },
    },
    {
      kind: "lookup",
      fields: ["lockedUntil"],
      options: { name: "ix_user-auth_lockedUntil" },
    },
  ];

  private _userId = "";

  private _hash = "";
  private _hashAlgo = "";
  private _hashParamsJson?: string;

  private _failedAttemptCount = 0;
  private _lastFailedAt?: string;
  private _lockedUntil?: string;

  private _passwordCreatedAt = "";
  private _passwordUpdatedAt?: string;

  public constructor(
    secretOrMeta?:
      | symbol
      | {
          createdAt?: string;
          updatedAt?: string;
          updatedByUserId?: string;
          ownerUserId?: string;
        }
  ) {
    super(secretOrMeta);
  }

  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): UserAuthDto {
    const dto = new UserAuthDto(DtoBase.getSecret());

    const unwrapped = unwrapMetaEnvelope(json);
    const j = (unwrapped ?? {}) as Partial<UserAuthJson>;

    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    dto.setUserId(j.userId, { validate: opts?.validate });
    dto.setHash(j.hash, { validate: opts?.validate });
    dto.setHashAlgo(j.hashAlgo, { validate: opts?.validate });
    dto.setHashParamsJson(j.hashParamsJson, { validate: opts?.validate });

    dto.setFailedAttemptCount(j.failedAttemptCount, {
      validate: opts?.validate,
    });
    dto.setLastFailedAt(j.lastFailedAt, { validate: opts?.validate });
    dto.setLockedUntil(j.lockedUntil, { validate: opts?.validate });

    dto.setPasswordCreatedAt(j.passwordCreatedAt, { validate: opts?.validate });
    dto.setPasswordUpdatedAt(j.passwordUpdatedAt, { validate: opts?.validate });

    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
      ownerUserId: j.ownerUserId,
    });

    return dto;
  }

  public get userId(): string {
    return this._userId;
  }

  public setUserId(value: unknown, opts?: UserAuthFieldOptions): this {
    const raw =
      typeof value === "string"
        ? value.trim()
        : value == null
        ? ""
        : String(value).trim();

    if (!opts?.validate) {
      this._userId = raw;
      return this;
    }

    if (!raw) throw new Error("UserAuthDto.userId: field is required.");
    this._userId = raw;
    return this;
  }

  public get hash(): string {
    return this._hash;
  }

  public setHash(value: unknown, opts?: UserAuthFieldOptions): this {
    const raw =
      typeof value === "string"
        ? value.trim()
        : value == null
        ? ""
        : String(value).trim();

    if (!opts?.validate) {
      this._hash = raw;
      return this;
    }

    if (!raw) throw new Error("UserAuthDto.hash: field is required.");
    this._hash = raw;
    return this;
  }

  public get hashAlgo(): string {
    return this._hashAlgo;
  }

  public setHashAlgo(value: unknown, opts?: UserAuthFieldOptions): this {
    const raw =
      typeof value === "string"
        ? value.trim()
        : value == null
        ? ""
        : String(value).trim();

    if (!opts?.validate) {
      this._hashAlgo = raw;
      return this;
    }

    if (!raw) throw new Error("UserAuthDto.hashAlgo: field is required.");
    this._hashAlgo = raw;
    return this;
  }

  public get hashParamsJson(): string | undefined {
    return this._hashParamsJson;
  }

  public setHashParamsJson(value: unknown, opts?: UserAuthFieldOptions): this {
    if (value === undefined || value === null || value === "") {
      this._hashParamsJson = undefined;
      return this;
    }

    const trimmed =
      typeof value === "string" ? value.trim() : String(value).trim();

    if (!trimmed) {
      this._hashParamsJson = undefined;
      return this;
    }

    if (!opts?.validate) {
      this._hashParamsJson = trimmed;
      return this;
    }

    try {
      JSON.parse(trimmed);
    } catch {
      throw new Error(
        "UserAuthDto.hashParamsJson: value must be a valid JSON string."
      );
    }

    this._hashParamsJson = trimmed;
    return this;
  }

  public get failedAttemptCount(): number {
    return this._failedAttemptCount;
  }

  public setFailedAttemptCount(
    value: unknown,
    opts?: UserAuthFieldOptions
  ): this {
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim().length
        ? Number(value)
        : NaN;

    if (!opts?.validate) {
      this._failedAttemptCount = Number.isFinite(n) ? Math.trunc(n) : 0;
      if (this._failedAttemptCount < 0) this._failedAttemptCount = 0;
      return this;
    }

    if (!Number.isFinite(n)) {
      throw new Error("UserAuthDto.failedAttemptCount: field is required.");
    }
    const t = Math.trunc(n);
    if (t < 0) {
      throw new Error(
        "UserAuthDto.failedAttemptCount: must be a non-negative integer."
      );
    }
    this._failedAttemptCount = t;
    return this;
  }

  public get lastFailedAt(): string | undefined {
    return this._lastFailedAt;
  }

  public setLastFailedAt(value: unknown, opts?: UserAuthFieldOptions): this {
    if (value === undefined || value === null || value === "") {
      this._lastFailedAt = undefined;
      return this;
    }

    const trimmed =
      typeof value === "string" ? value.trim() : String(value).trim();

    if (!trimmed) {
      this._lastFailedAt = undefined;
      return this;
    }

    if (!opts?.validate) {
      this._lastFailedAt = trimmed;
      return this;
    }

    if (Number.isNaN(Date.parse(trimmed))) {
      throw new Error("UserAuthDto.lastFailedAt: must be an ISO timestamp.");
    }

    this._lastFailedAt = trimmed;
    return this;
  }

  public get lockedUntil(): string | undefined {
    return this._lockedUntil;
  }

  public setLockedUntil(value: unknown, opts?: UserAuthFieldOptions): this {
    if (value === undefined || value === null || value === "") {
      this._lockedUntil = undefined;
      return this;
    }

    const trimmed =
      typeof value === "string" ? value.trim() : String(value).trim();

    if (!trimmed) {
      this._lockedUntil = undefined;
      return this;
    }

    if (!opts?.validate) {
      this._lockedUntil = trimmed;
      return this;
    }

    if (Number.isNaN(Date.parse(trimmed))) {
      throw new Error("UserAuthDto.lockedUntil: must be an ISO timestamp.");
    }

    this._lockedUntil = trimmed;
    return this;
  }

  public get passwordCreatedAt(): string {
    return this._passwordCreatedAt;
  }

  public setPasswordCreatedAt(
    value: unknown,
    opts?: UserAuthFieldOptions
  ): this {
    const raw =
      typeof value === "string"
        ? value.trim()
        : value == null
        ? ""
        : String(value).trim();

    if (!opts?.validate) {
      this._passwordCreatedAt = raw;
      return this;
    }

    if (!raw) {
      throw new Error("UserAuthDto.passwordCreatedAt: field is required.");
    }

    if (Number.isNaN(Date.parse(raw))) {
      throw new Error(
        "UserAuthDto.passwordCreatedAt: must be an ISO timestamp."
      );
    }

    this._passwordCreatedAt = raw;
    return this;
  }

  public get passwordUpdatedAt(): string | undefined {
    return this._passwordUpdatedAt;
  }

  public setPasswordUpdatedAt(
    value: unknown,
    opts?: UserAuthFieldOptions
  ): this {
    if (value === undefined || value === null || value === "") {
      this._passwordUpdatedAt = undefined;
      return this;
    }

    const trimmed =
      typeof value === "string" ? value.trim() : String(value).trim();

    if (!trimmed) {
      this._passwordUpdatedAt = undefined;
      return this;
    }

    if (!opts?.validate) {
      this._passwordUpdatedAt = trimmed;
      return this;
    }

    if (Number.isNaN(Date.parse(trimmed))) {
      throw new Error(
        "UserAuthDto.passwordUpdatedAt: must be an ISO timestamp."
      );
    }

    this._passwordUpdatedAt = trimmed;
    return this;
  }

  public toBody(): UserAuthJson {
    const body: UserAuthJson = {
      _id: this.hasId() ? this.getId() : undefined,
      type: "user-auth",

      userId: this._userId,

      hash: this._hash,
      hashAlgo: this._hashAlgo,
      hashParamsJson: this._hashParamsJson,

      failedAttemptCount: this._failedAttemptCount,
      lastFailedAt: this._lastFailedAt,
      lockedUntil: this._lockedUntil,

      passwordCreatedAt: this._passwordCreatedAt,
      passwordUpdatedAt: this._passwordUpdatedAt,
    };

    return this._finalizeToJson(body);
  }

  public patchFrom(
    json: Partial<UserAuthJson>,
    opts?: { validate?: boolean }
  ): this {
    if (json.hash !== undefined) {
      this.setHash(json.hash, { validate: opts?.validate });
    }
    if (json.hashAlgo !== undefined) {
      this.setHashAlgo(json.hashAlgo, { validate: opts?.validate });
    }
    if (json.hashParamsJson !== undefined) {
      this.setHashParamsJson(json.hashParamsJson, { validate: opts?.validate });
    }
    if (json.failedAttemptCount !== undefined) {
      this.setFailedAttemptCount(json.failedAttemptCount, {
        validate: opts?.validate,
      });
    }
    if (json.lastFailedAt !== undefined) {
      this.setLastFailedAt(json.lastFailedAt, { validate: opts?.validate });
    }
    if (json.lockedUntil !== undefined) {
      this.setLockedUntil(json.lockedUntil, { validate: opts?.validate });
    }
    if (json.passwordCreatedAt !== undefined) {
      this.setPasswordCreatedAt(json.passwordCreatedAt, {
        validate: opts?.validate,
      });
    }
    if (json.passwordUpdatedAt !== undefined) {
      this.setPasswordUpdatedAt(json.passwordUpdatedAt, {
        validate: opts?.validate,
      });
    }

    return this;
  }

  public getType(): string {
    return "user-auth";
  }
}
