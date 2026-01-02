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
 *   - ADR-0089 (DTO Field DSL with Meta Envelope)
 *   - ADR-0090 (DTO Field DSL Design + Non-Breaking Integration)
 *   - ADR-0092 (DTO Fields DSL + Testdata Generation)
 *
 * Purpose:
 * - Concrete DTO for the "user" entity service.
 * - Field set is aligned with AuthDto so that an AuthToUserDtoMapperHandler
 *   can map directly without renaming:
 *     givenName, lastName, email, phone, homeLat, homeLng
 * - Extended with basic address fields for global use:
 *     address1, address2, city, state, pcode, notes
 *
 * Design:
 * - All domain fields are private, accessed via getters + setters.
 * - Setters accept an optional `{ validate?: boolean }` flag:
 *     • validate=false → normalize only.
 *     • validate=true  → enforce required/format rules and throw on violations.
 * - Name-like fields use DtoBase.normalizeRequiredName(...) for shared rules.
 */

import { DtoBase } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";
import { assertValidEmail } from "../utils/emailCheck";
import { field, unwrapMetaEnvelope } from "./dsl";

export type UserJson = {
  _id?: string;
  type?: "user";

  givenName: string;
  lastName: string;
  email: string;
  phone?: string;
  homeLat?: number;
  homeLng?: number;

  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  pcode?: string;
  notes?: string;

  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
  ownerUserId?: string;
};

export interface UserFieldOptions {
  validate?: boolean;
}

/**
 * DTO Field DSL (v1).
 * - Purely metadata/tooling hints; does not affect toBody()/persistence/S2S.
 * - UI metadata is canonical prompt identity ONLY (Option B).
 *   Consumers may prepend scope or override prompt keys externally.
 */
export const UserFields = {
  type: field.literal("user", { required: false, presentByDefault: true }),

  givenName: field.string({
    required: true,
    minLen: 1,
    maxLen: 80,
    alpha: true,
    case: "capitalized",
    ui: {
      input: "text",
      promptKey: "user.givenName",
    },
  }),

  lastName: field.string({
    required: true,
    minLen: 1,
    maxLen: 80,
    alpha: true,
    case: "capitalized",
    ui: {
      input: "text",
      promptKey: "user.lastName",
    },
  }),

  email: field.string({
    required: true,
    unique: true,
    minLen: 5,
    maxLen: 200,
    format: "email",
    ui: {
      input: "email",
      promptKey: "user.email",
    },
  }),

  phone: field.string({
    required: false,
    unique: true,
    presentByDefault: false,
    format: "phoneDigits",
    ui: {
      input: "tel",
      promptKey: "user.phone",
    },
  }),

  homeLat: field.number({
    required: false,
    presentByDefault: false,
    format: "lat",
  }),
  homeLng: field.number({
    required: false,
    presentByDefault: false,
    format: "lng",
  }),

  address1: field.string({ required: false, presentByDefault: false }),
  address2: field.string({ required: false, presentByDefault: false }),
  city: field.string({ required: false, presentByDefault: false }),
  state: field.string({
    required: false,
    presentByDefault: false,
    format: "state2",
  }),
  pcode: field.string({
    required: false,
    presentByDefault: false,
    format: "zip5",
  }),
  notes: field.string({ required: false, presentByDefault: false }),
} as const;

export class UserDto extends DtoBase {
  public static dbCollectionName(): string {
    return "user";
  }

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

  // ─────────────── Instance: Domain Fields (private) ───────────────

  private _givenName = "";
  private _lastName = "";
  private _email = "";
  private _phone?: string;
  private _homeLat?: number;
  private _homeLng?: number;

  private _address1?: string;
  private _address2?: string;
  private _city?: string;
  private _state?: string;
  private _pcode?: string;
  private _notes?: string;

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

  // ─────────────── Static: Hydration ───────────────

  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): UserDto {
    const dto = new UserDto(DtoBase.getSecret());

    // ADR-0089/0090: tolerate inbound { data, meta } without breaking.
    const unwrapped = unwrapMetaEnvelope(json);
    const j = (unwrapped ?? {}) as Partial<UserJson>;

    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    dto.setGivenName(j.givenName, { validate: opts?.validate });
    dto.setLastName(j.lastName, { validate: opts?.validate });
    dto.setEmail(j.email, { validate: opts?.validate });

    dto.setPhone(j.phone, { validate: opts?.validate });
    dto.setHomeLat(j.homeLat, { validate: opts?.validate });
    dto.setHomeLng(j.homeLng, { validate: opts?.validate });

    dto.setAddress1(j.address1, { validate: opts?.validate });
    dto.setAddress2(j.address2, { validate: opts?.validate });
    dto.setCity(j.city, { validate: opts?.validate });
    dto.setState(j.state, { validate: opts?.validate });
    dto.setPcode(j.pcode, { validate: opts?.validate });
    dto.setNotes(j.notes, { validate: opts?.validate });

    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
      ownerUserId: j.ownerUserId,
    });

    return dto;
  }

  // ─────────────── Getters / Setters ───────────────

  public get givenName(): string {
    return this._givenName;
  }

  public setGivenName(value: unknown, opts?: UserFieldOptions): this {
    this._givenName = DtoBase.normalizeRequiredName(
      value,
      "UserDto.givenName",
      { validate: opts?.validate }
    );
    return this;
  }

  public get lastName(): string {
    return this._lastName;
  }

  public setLastName(value: unknown, opts?: UserFieldOptions): this {
    this._lastName = DtoBase.normalizeRequiredName(value, "UserDto.lastName", {
      validate: opts?.validate,
    });
    return this;
  }

  public get email(): string {
    return this._email;
  }

  public setEmail(value: unknown, opts?: UserFieldOptions): this {
    const raw =
      typeof value === "string"
        ? value.trim()
        : value == null
        ? ""
        : String(value).trim();

    if (!opts?.validate) {
      this._email = raw;
      return this;
    }

    if (!raw) {
      throw new Error("UserDto.email: field is required.");
    }

    this._email = assertValidEmail(raw, "UserDto.email");
    return this;
  }

  public get phone(): string | undefined {
    return this._phone;
  }

  public setPhone(value: unknown, _opts?: UserFieldOptions): this {
    if (value === undefined || value === null) {
      this._phone = undefined;
      return this;
    }

    const trimmed =
      typeof value === "string" ? value.trim() : String(value).trim();
    this._phone = trimmed.length ? trimmed : undefined;
    return this;
  }

  public get homeLat(): number | undefined {
    return this._homeLat;
  }

  public setHomeLat(value: unknown, _opts?: UserFieldOptions): this {
    if (value === undefined || value === null || value === "") {
      this._homeLat = undefined;
      return this;
    }

    const n =
      typeof value === "string"
        ? Number(value)
        : typeof value === "number"
        ? value
        : NaN;

    if (Number.isFinite(n)) {
      this._homeLat = n;
    }
    return this;
  }

  public get homeLng(): number | undefined {
    return this._homeLng;
  }

  public setHomeLng(value: unknown, _opts?: UserFieldOptions): this {
    if (value === undefined || value === null || value === "") {
      this._homeLng = undefined;
      return this;
    }

    const n =
      typeof value === "string"
        ? Number(value)
        : typeof value === "number"
        ? value
        : NaN;

    if (Number.isFinite(n)) {
      this._homeLng = n;
    }
    return this;
  }

  public get address1(): string | undefined {
    return this._address1;
  }

  public setAddress1(value: unknown, _opts?: UserFieldOptions): this {
    this._address1 = this.normalizeOptionalString(value);
    return this;
  }

  public get address2(): string | undefined {
    return this._address2;
  }

  public setAddress2(value: unknown, _opts?: UserFieldOptions): this {
    this._address2 = this.normalizeOptionalString(value);
    return this;
  }

  public get city(): string | undefined {
    return this._city;
  }

  public setCity(value: unknown, _opts?: UserFieldOptions): this {
    this._city = this.normalizeOptionalString(value);
    return this;
  }

  public get state(): string | undefined {
    return this._state;
  }

  public setState(value: unknown, _opts?: UserFieldOptions): this {
    this._state = this.normalizeOptionalString(value);
    return this;
  }

  public get pcode(): string | undefined {
    return this._pcode;
  }

  public setPcode(value: unknown, _opts?: UserFieldOptions): this {
    this._pcode = this.normalizeOptionalString(value);
    return this;
  }

  public get notes(): string | undefined {
    return this._notes;
  }

  public setNotes(value: unknown, _opts?: UserFieldOptions): this {
    this._notes = this.normalizeOptionalString(value);
    return this;
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const trimmed =
      typeof value === "string" ? value.trim() : String(value).trim();
    return trimmed.length ? trimmed : undefined;
  }

  // ─────────────── Wire Shape ───────────────

  public toBody(): UserJson {
    const body: UserJson = {
      _id: this.hasId() ? this.getId() : undefined,
      type: "user",

      givenName: this._givenName,
      lastName: this._lastName,
      email: this._email,
      phone: this._phone,
      homeLat: this._homeLat,
      homeLng: this._homeLng,

      address1: this._address1,
      address2: this._address2,
      city: this._city,
      state: this._state,
      pcode: this._pcode,
      notes: this._notes,
    };

    return this._finalizeToJson(body);
  }

  // ─────────────── Patch Helper ───────────────

  public patchFrom(
    json: Partial<UserJson>,
    opts?: { validate?: boolean }
  ): this {
    if (json.givenName !== undefined) {
      this.setGivenName(json.givenName, { validate: opts?.validate });
    }
    if (json.lastName !== undefined) {
      this.setLastName(json.lastName, { validate: opts?.validate });
    }
    if (json.email !== undefined) {
      this.setEmail(json.email, { validate: opts?.validate });
    }
    if (json.phone !== undefined) {
      this.setPhone(json.phone, { validate: opts?.validate });
    }
    if (json.homeLat !== undefined) {
      this.setHomeLat(json.homeLat, { validate: opts?.validate });
    }
    if (json.homeLng !== undefined) {
      this.setHomeLng(json.homeLng, { validate: opts?.validate });
    }
    if (json.address1 !== undefined) {
      this.setAddress1(json.address1, { validate: opts?.validate });
    }
    if (json.address2 !== undefined) {
      this.setAddress2(json.address2, { validate: opts?.validate });
    }
    if (json.city !== undefined) {
      this.setCity(json.city, { validate: opts?.validate });
    }
    if (json.state !== undefined) {
      this.setState(json.state, { validate: opts?.validate });
    }
    if (json.pcode !== undefined) {
      this.setPcode(json.pcode, { validate: opts?.validate });
    }
    if (json.notes !== undefined) {
      this.setNotes(json.notes, { validate: opts?.validate });
    }

    return this;
  }

  // ─────────────── Type Discriminator ───────────────

  public getType(): string {
    return "user";
  }
}
