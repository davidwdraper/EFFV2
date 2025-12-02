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

import { DtoBase, UserType } from "./DtoBase";

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
      dto.userId = j.userId.trim();
    }

    if (typeof j.hash === "string" && j.hash.trim()) {
      dto.hash = j.hash;
    }

    if (typeof j.hashAlgo === "string" && j.hashAlgo.trim()) {
      dto.hashAlgo = j.hashAlgo;
    }

    if (typeof j.hashParamsJson === "string" && j.hashParamsJson.trim()) {
      dto.hashParamsJson = j.hashParamsJson;
    }

    if (typeof j.failedAttemptCount === "number") {
      const n = Math.trunc(j.failedAttemptCount);
      dto.failedAttemptCount = n >= 0 ? n : 0;
    }

    if (typeof j.lastFailedAt === "string" && j.lastFailedAt.trim()) {
      dto.lastFailedAt = j.lastFailedAt;
    }

    if (typeof j.lockedUntil === "string" && j.lockedUntil.trim()) {
      dto.lockedUntil = j.lockedUntil;
    }

    if (typeof j.passwordCreatedAt === "string" && j.passwordCreatedAt.trim()) {
      dto.passwordCreatedAt = j.passwordCreatedAt;
    }

    if (typeof j.passwordUpdatedAt === "string" && j.passwordUpdatedAt.trim()) {
      dto.passwordUpdatedAt = j.passwordUpdatedAt;
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

    if (json.hash !== undefined && typeof json.hash === "string") {
      this.hash = json.hash;
    }

    if (json.hashAlgo !== undefined && typeof json.hashAlgo === "string") {
      this.hashAlgo = json.hashAlgo;
    }

    if (json.hashParamsJson !== undefined) {
      if (
        json.hashParamsJson === null ||
        json.hashParamsJson === undefined ||
        json.hashParamsJson === ""
      ) {
        this.hashParamsJson = undefined;
      } else if (typeof json.hashParamsJson === "string") {
        this.hashParamsJson = json.hashParamsJson;
      }
    }

    if (json.failedAttemptCount !== undefined) {
      const raw =
        typeof json.failedAttemptCount === "string"
          ? Number(json.failedAttemptCount)
          : json.failedAttemptCount;
      if (Number.isFinite(raw)) {
        const n = Math.trunc(raw as number);
        this.failedAttemptCount = n >= 0 ? n : 0;
      }
    }

    if (json.lastFailedAt !== undefined) {
      if (typeof json.lastFailedAt === "string" && json.lastFailedAt.trim()) {
        this.lastFailedAt = json.lastFailedAt;
      } else {
        this.lastFailedAt = undefined;
      }
    }

    if (json.lockedUntil !== undefined) {
      if (typeof json.lockedUntil === "string" && json.lockedUntil.trim()) {
        this.lockedUntil = json.lockedUntil;
      } else {
        this.lockedUntil = undefined;
      }
    }

    if (json.passwordCreatedAt !== undefined) {
      if (
        typeof json.passwordCreatedAt === "string" &&
        json.passwordCreatedAt.trim()
      ) {
        this.passwordCreatedAt = json.passwordCreatedAt;
      }
    }

    if (json.passwordUpdatedAt !== undefined) {
      if (
        typeof json.passwordUpdatedAt === "string" &&
        json.passwordUpdatedAt.trim()
      ) {
        this.passwordUpdatedAt = json.passwordUpdatedAt;
      } else {
        this.passwordUpdatedAt = undefined;
      }
    }

    return this;
  }

  // ==== Type Discriminator ==================================================

  public getType(): string {
    return "user-auth";
  }
}
