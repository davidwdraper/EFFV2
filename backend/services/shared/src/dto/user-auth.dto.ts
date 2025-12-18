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
 *
 * Purpose:
 * - Concrete DTO for persisted user authentication credentials ("user-auth" service).
 * - Stores ONLY opaque, hashed credential data — never cleartext secrets.
 * - The Auth pipeline is responsible for:
 *   • deriving hash + parameters from cleartext input DTO(s),
 *   • writing a single UserAuthDto per userId.
 */

import { DtoBase } from "./DtoBase";
import { UserType } from "./UserType";

import type { IndexHint } from "./persistence/index-hints";

// Wire-friendly shape for persisted auth info
type UserAuthJson = {
  _id?: string;
  type?: "user-auth";

  // Foreign key to User record
  userId: string;

  // Credential material (opaque from caller perspective)
  hash: string; // password hash (opaque blob; includes salt if algo embeds it)
  hashAlgo: string; // e.g., "argon2id", "bcrypt"
  hashParamsJson?: string; // JSON string with algo-specific parameters, if needed

  // Lockout & failure tracking
  failedAttemptCount: number;
  lastFailedAt?: string; // ISO timestamp of last failed attempt
  lockedUntil?: string; // ISO timestamp until which authentication is locked

  // Password lifecycle (distinct from generic createdAt/updatedAt)
  passwordCreatedAt: string; // when this credential was first minted
  passwordUpdatedAt?: string;

  // DTO-level metadata (managed by DtoBase)
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class UserAuthDto extends DtoBase {
  public static dbCollectionName(): string {
    return "user-auth";
  }

  /**
   * Per-field access rules.
   * - read: minimum UserType required to read via `readField()`.
   * - write: minimum UserType required to write via `writeField()`.
   *
   * NOTE:
   * - Auth credentials are highly sensitive; only system-level actors may access them.
   * - Missing rules are a hard error (see DtoBase.readField/writeField).
   */
  public static readonly access = {
    userId: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
    hash: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
    hashAlgo: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
    hashParamsJson: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
    failedAttemptCount: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
    lastFailedAt: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
    lockedUntil: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
    passwordCreatedAt: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
    passwordUpdatedAt: {
      read: UserType.AdminSystem,
      write: UserType.AdminSystem,
    },
  } as const;

  /**
   * Index strategy:
   * - Unique userId: one active credential record per user.
   * - Lookup on userId for fast auth lookups.
   * - Optional lookup on lockedUntil to support maintenance/ops queries.
   */
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

  // ==== Fields ===============================================================

  public userId = "";

  public hash = "";
  public hashAlgo = "";
  public hashParamsJson?: string;

  public failedAttemptCount = 0;
  public lastFailedAt?: string;
  public lockedUntil?: string;

  public passwordCreatedAt = "";
  public passwordUpdatedAt?: string;

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
  }

  // ==== Validated Setters ===================================================

  public setUserId(userId: string): this {
    const v = typeof userId === "string" ? userId.trim() : "";
    if (!v) {
      throw new Error(
        "UserAuthDto.setUserId: userId must be a non-empty string."
      );
    }
    this.userId = v;
    return this;
  }

  public setHash(hash: string): this {
    const v = typeof hash === "string" ? hash.trim() : "";
    if (!v) {
      throw new Error("UserAuthDto.setHash: hash must be a non-empty string.");
    }
    this.hash = v;
    return this;
  }

  public setHashAlgo(hashAlgo: string): this {
    const v = typeof hashAlgo === "string" ? hashAlgo.trim() : "";
    if (!v) {
      throw new Error(
        "UserAuthDto.setHashAlgo: hashAlgo must be a non-empty string (e.g., 'argon2id', 'bcrypt', 'scrypt')."
      );
    }
    this.hashAlgo = v;
    return this;
  }

  public setHashParamsJson(hashParamsJson: string | undefined | null): this {
    if (
      hashParamsJson === undefined ||
      hashParamsJson === null ||
      hashParamsJson === ""
    ) {
      this.hashParamsJson = undefined;
      return this;
    }

    const v = hashParamsJson.trim();
    if (!v) {
      this.hashParamsJson = undefined;
      return this;
    }

    // Validate that it is well-formed JSON for Ops sanity.
    try {
      JSON.parse(v);
    } catch {
      throw new Error(
        "UserAuthDto.setHashParamsJson: value must be a valid JSON string describing hash parameters."
      );
    }

    this.hashParamsJson = v;
    return this;
  }

  public setFailedAttemptCount(count: number): this {
    if (!Number.isFinite(count)) {
      throw new Error(
        "UserAuthDto.setFailedAttemptCount: count must be a finite number."
      );
    }
    const n = Math.trunc(count);
    if (n < 0) {
      throw new Error(
        "UserAuthDto.setFailedAttemptCount: count must be a non-negative integer."
      );
    }
    this.failedAttemptCount = n;
    return this;
  }

  public setLastFailedAt(iso: string | undefined | null): this {
    if (!iso) {
      this.lastFailedAt = undefined;
      return this;
    }
    const v = iso.trim();
    if (!v) {
      this.lastFailedAt = undefined;
      return this;
    }
    if (Number.isNaN(Date.parse(v))) {
      throw new Error(
        "UserAuthDto.setLastFailedAt: value must be an ISO-8601 timestamp string."
      );
    }
    this.lastFailedAt = v;
    return this;
  }

  public setLockedUntil(iso: string | undefined | null): this {
    if (!iso) {
      this.lockedUntil = undefined;
      return this;
    }
    const v = iso.trim();
    if (!v) {
      this.lockedUntil = undefined;
      return this;
    }
    if (Number.isNaN(Date.parse(v))) {
      throw new Error(
        "UserAuthDto.setLockedUntil: value must be an ISO-8601 timestamp string."
      );
    }
    this.lockedUntil = v;
    return this;
  }

  public setPasswordCreatedAt(iso: string): this {
    const v = typeof iso === "string" ? iso.trim() : "";
    if (!v || Number.isNaN(Date.parse(v))) {
      throw new Error(
        "UserAuthDto.setPasswordCreatedAt: value must be a non-empty ISO-8601 timestamp string."
      );
    }
    this.passwordCreatedAt = v;
    return this;
  }

  public setPasswordUpdatedAt(iso: string | undefined | null): this {
    if (!iso) {
      this.passwordUpdatedAt = undefined;
      return this;
    }
    const v = iso.trim();
    if (!v) {
      this.passwordUpdatedAt = undefined;
      return this;
    }
    if (Number.isNaN(Date.parse(v))) {
      throw new Error(
        "UserAuthDto.setPasswordUpdatedAt: value must be an ISO-8601 timestamp string."
      );
    }
    this.passwordUpdatedAt = v;
    return this;
  }

  // ==== Construction ========================================================

  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): UserAuthDto {
    const dto = new UserAuthDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<UserAuthJson>;

    // Canonical id (NOT the userId; see ADR-0050/0057)
    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    if (typeof j.userId === "string" && j.userId.trim()) {
      dto.setUserId(j.userId);
    }

    if (typeof j.hash === "string" && j.hash.trim()) {
      dto.setHash(j.hash);
    }

    if (typeof j.hashAlgo === "string" && j.hashAlgo.trim()) {
      dto.setHashAlgo(j.hashAlgo);
    }

    if (typeof j.hashParamsJson === "string") {
      dto.setHashParamsJson(j.hashParamsJson);
    }

    if (typeof j.failedAttemptCount === "number") {
      dto.setFailedAttemptCount(j.failedAttemptCount);
    }

    if (typeof j.lastFailedAt === "string") {
      dto.setLastFailedAt(j.lastFailedAt);
    }

    if (typeof j.lockedUntil === "string") {
      dto.setLockedUntil(j.lockedUntil);
    }

    if (typeof j.passwordCreatedAt === "string" && j.passwordCreatedAt.trim()) {
      dto.setPasswordCreatedAt(j.passwordCreatedAt);
    }

    if (typeof j.passwordUpdatedAt === "string") {
      dto.setPasswordUpdatedAt(j.passwordUpdatedAt);
    }

    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    // opts?.validate hook can wire in Zod later if needed.
    if (opts?.validate) {
      // Minimal hard validation: we must have userId, hash, hashAlgo, passwordCreatedAt.
      if (!dto.userId || !dto.hash || !dto.hashAlgo || !dto.passwordCreatedAt) {
        throw new Error(
          "UserAuthDto.fromBody: missing required fields (userId, hash, hashAlgo, passwordCreatedAt)."
        );
      }
    }

    return dto;
  }

  // ==== Serialization =======================================================

  public toBody(): UserAuthJson {
    const body: UserAuthJson = {
      // DO NOT generate id here — DbWriter ensures id BEFORE calling toBody().
      _id: this.hasId() ? this.getId() : undefined,
      type: "user-auth",

      userId: this.userId,

      hash: this.hash,
      hashAlgo: this.hashAlgo,
      hashParamsJson: this.hashParamsJson,

      failedAttemptCount: this.failedAttemptCount,
      lastFailedAt: this.lastFailedAt,
      lockedUntil: this.lockedUntil,

      passwordCreatedAt: this.passwordCreatedAt,
      passwordUpdatedAt: this.passwordUpdatedAt,
    };

    return this._finalizeToJson(body);
  }

  // ==== Patch ===============================================================

  public patchFrom(json: Partial<UserAuthJson>): this {
    // NOTE:
    // - We intentionally do NOT allow patching userId via patchFrom.
    //   Changing userId should be treated as an exceptional migration-only operation.

    if (json.hash !== undefined) {
      if (typeof json.hash === "string") {
        this.setHash(json.hash);
      } else {
        throw new Error(
          "UserAuthDto.patchFrom: hash must be a string when provided."
        );
      }
    }

    if (json.hashAlgo !== undefined) {
      if (typeof json.hashAlgo === "string") {
        this.setHashAlgo(json.hashAlgo);
      } else {
        throw new Error(
          "UserAuthDto.patchFrom: hashAlgo must be a string when provided."
        );
      }
    }

    if (json.hashParamsJson !== undefined) {
      this.setHashParamsJson(json.hashParamsJson as string | undefined | null);
    }

    if (json.failedAttemptCount !== undefined) {
      const raw =
        typeof json.failedAttemptCount === "string"
          ? Number(json.failedAttemptCount)
          : json.failedAttemptCount;
      if (!Number.isFinite(raw)) {
        throw new Error(
          "UserAuthDto.patchFrom: failedAttemptCount must be a finite number or numeric string."
        );
      }
      this.setFailedAttemptCount(raw as number);
    }

    if (json.lastFailedAt !== undefined) {
      this.setLastFailedAt(json.lastFailedAt ?? null);
    }

    if (json.lockedUntil !== undefined) {
      this.setLockedUntil(json.lockedUntil ?? null);
    }

    if (json.passwordCreatedAt !== undefined) {
      if (
        json.passwordCreatedAt === undefined ||
        json.passwordCreatedAt === null
      ) {
        // Creation time should not normally be cleared; treat as a no-op.
      } else if (typeof json.passwordCreatedAt === "string") {
        this.setPasswordCreatedAt(json.passwordCreatedAt);
      } else {
        throw new Error(
          "UserAuthDto.patchFrom: passwordCreatedAt must be a string when provided."
        );
      }
    }

    if (json.passwordUpdatedAt !== undefined) {
      this.setPasswordUpdatedAt(json.passwordUpdatedAt ?? null);
    }

    return this;
  }

  // ==== Type Discriminator ==================================================

  public getType(): string {
    return "user-auth";
  }
}
