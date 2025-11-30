// backend/services/shared/src/dto/user.dto.ts
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
 * - Concrete DTO for the "user" entity service.
 * - Field set is aligned with AuthDto so that an AuthToUserDtoMapperHandler
 *   can map directly without renaming:
 *     givenName, lastName, email, phone, homeLat, homeLng
 * - Extended with basic address fields for global use:
 *     address1, address2, city, state, pcode, notes
 */

import { DtoBase } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";

// Wire-friendly shape
export type UserJson = {
  // Entity canonical id on the wire for CRUD services.
  _id?: string;
  type?: "user";

  // Auth-compatible identity basics
  givenName: string;
  lastName: string;
  email: string;
  phone?: string;
  homeLat?: number;
  homeLng?: number;

  // Address / profile extensions
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  pcode?: string; // postal code, not "zip", for global usage
  notes?: string;

  // Meta fields stamped via DtoBase
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class UserDto extends DtoBase {
  public static dbCollectionName(): string {
    return "user";
  }

  // Index strategy:
  // - Email is globally unique per user (login / identity).
  // - Name lookup supports basic search (lastName + givenName).
  // Additional geo / locality indexes can be added once query patterns stabilize.
  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    {
      kind: "unique",
      fields: ["email"],
      options: { name: "ux_user_email" },
    },
    {
      kind: "lookup",
      fields: ["lastName", "givenName"],
      options: { name: "ix_user_name" },
    },
  ];

  // ─────────────── Instance: Domain Fields ───────────────

  // Identity basics (aligned with AuthDto)
  public givenName = "";
  public lastName = "";
  public email = "";
  public phone?: string;
  public homeLat?: number;
  public homeLng?: number;

  // Address / profile
  public address1?: string;
  public address2?: string;
  public city?: string;
  public state?: string;
  public pcode?: string;
  public notes?: string;

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
  }

  // ─────────────── Static: Hydration ───────────────

  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): UserDto {
    const dto = new UserDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<UserJson>;

    // Canonical entity id for CRUD services lives in `_id`.
    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    // Required-ish identity fields (formal validation via contract layer later)
    if (typeof j.givenName === "string") {
      dto.givenName = j.givenName.trim();
    }

    if (typeof j.lastName === "string") {
      dto.lastName = j.lastName.trim();
    }

    if (typeof j.email === "string") {
      dto.email = j.email.trim().toLowerCase();
    }

    if (typeof j.phone === "string") {
      const trimmed = j.phone.trim();
      dto.phone = trimmed.length ? trimmed : undefined;
    }

    // homeLat / homeLng: accept number or numeric string; ignore NaN.
    if (j.homeLat !== undefined) {
      const n = typeof j.homeLat === "string" ? Number(j.homeLat) : j.homeLat;
      if (Number.isFinite(n as number)) {
        dto.homeLat = n as number;
      }
    }

    if (j.homeLng !== undefined) {
      const n = typeof j.homeLng === "string" ? Number(j.homeLng) : j.homeLng;
      if (Number.isFinite(n as number)) {
        dto.homeLng = n as number;
      }
    }

    // Address / profile fields (simple string normalization)
    if (typeof j.address1 === "string") {
      const trimmed = j.address1.trim();
      dto.address1 = trimmed.length ? trimmed : undefined;
    }

    if (typeof j.address2 === "string") {
      const trimmed = j.address2.trim();
      dto.address2 = trimmed.length ? trimmed : undefined;
    }

    if (typeof j.city === "string") {
      const trimmed = j.city.trim();
      dto.city = trimmed.length ? trimmed : undefined;
    }

    if (typeof j.state === "string") {
      const trimmed = j.state.trim();
      dto.state = trimmed.length ? trimmed : undefined;
    }

    if (typeof j.pcode === "string") {
      const trimmed = j.pcode.trim();
      dto.pcode = trimmed.length ? trimmed : undefined;
    }

    if (typeof j.notes === "string") {
      const trimmed = j.notes.trim();
      dto.notes = trimmed.length ? trimmed : undefined;
    }

    // Meta (for DtoBase._finalizeToJson)
    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    // opts?.validate hook: Zod contract goes here when defined.
    void opts;

    return dto;
  }

  // ─────────────── Instance: Wire Shape ───────────────

  public toBody(): UserJson {
    const body: UserJson = {
      // DO NOT generate id here — DbWriter ensures id BEFORE calling toBody().
      _id: this.hasId() ? this.getId() : undefined,
      type: "user",

      givenName: this.givenName,
      lastName: this.lastName,
      email: this.email,
      phone: this.phone,
      homeLat: this.homeLat,
      homeLng: this.homeLng,

      address1: this.address1,
      address2: this.address2,
      city: this.city,
      state: this.state,
      pcode: this.pcode,
      notes: this.notes,
    };

    return this._finalizeToJson(body);
  }

  // ─────────────── Instance: Patch Helper ───────────────

  public patchFrom(json: Partial<UserJson>): this {
    if (json.givenName !== undefined && typeof json.givenName === "string") {
      this.givenName = json.givenName.trim();
    }

    if (json.lastName !== undefined && typeof json.lastName === "string") {
      this.lastName = json.lastName.trim();
    }

    if (json.email !== undefined && typeof json.email === "string") {
      this.email = json.email.trim().toLowerCase();
    }

    if (json.phone !== undefined) {
      if (typeof json.phone === "string") {
        const trimmed = json.phone.trim();
        this.phone = trimmed.length ? trimmed : undefined;
      } else {
        this.phone = undefined;
      }
    }

    if (json.homeLat !== undefined) {
      const n =
        typeof json.homeLat === "string" ? Number(json.homeLat) : json.homeLat;
      if (Number.isFinite(n as number)) {
        this.homeLat = n as number;
      }
    }

    if (json.homeLng !== undefined) {
      const n =
        typeof json.homeLng === "string" ? Number(json.homeLng) : json.homeLng;
      if (Number.isFinite(n as number)) {
        this.homeLng = n as number;
      }
    }

    if (json.address1 !== undefined) {
      if (typeof json.address1 === "string") {
        const trimmed = json.address1.trim();
        this.address1 = trimmed.length ? trimmed : undefined;
      } else {
        this.address1 = undefined;
      }
    }

    if (json.address2 !== undefined) {
      if (typeof json.address2 === "string") {
        const trimmed = json.address2.trim();
        this.address2 = trimmed.length ? trimmed : undefined;
      } else {
        this.address2 = undefined;
      }
    }

    if (json.city !== undefined) {
      if (typeof json.city === "string") {
        const trimmed = json.city.trim();
        this.city = trimmed.length ? trimmed : undefined;
      } else {
        this.city = undefined;
      }
    }

    if (json.state !== undefined) {
      if (typeof json.state === "string") {
        const trimmed = json.state.trim();
        this.state = trimmed.length ? trimmed : undefined;
      } else {
        this.state = undefined;
      }
    }

    if (json.pcode !== undefined) {
      if (typeof json.pcode === "string") {
        const trimmed = json.pcode.trim();
        this.pcode = trimmed.length ? trimmed : undefined;
      } else {
        this.pcode = undefined;
      }
    }

    if (json.notes !== undefined) {
      if (typeof json.notes === "string") {
        const trimmed = json.notes.trim();
        this.notes = trimmed.length ? trimmed : undefined;
      } else {
        this.notes = undefined;
      }
    }

    return this;
  }

  // ─────────────── Type Discriminator ───────────────

  public getType(): string {
    return "user";
  }
}
