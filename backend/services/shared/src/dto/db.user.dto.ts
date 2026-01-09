// backend/services/shared/src/dto/db.user.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *   - ADR-0103 (DTO naming convention: keys, filenames, classnames)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable)
 *
 * Purpose:
 * - Concrete DB DTO for the "user" collection.
 *
 * Naming (ADR-0103):
 * - File: db.user.dto.ts
 * - Key:  db.user.dto
 * - Class: DbUserDto
 *
 * Construction (ADR-0102):
 * - Scenario A: new DbUserDto(secret) => MUST mint _id
 * - Scenario B: new DbUserDto(secret, { body }) => MUST require _id UUIDv4, MUST NOT mint
 */

import { DtoBase, type DtoCtorOpts } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";
import { assertValidEmail } from "../utils/emailCheck";
import { validateUUIDString } from "../utils/uuid";
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

export const UserFields = {
  type: field.literal("user", { required: false, presentByDefault: true }),

  givenName: field.string({
    required: true,
    minLen: 1,
    maxLen: 80,
    alpha: true,
    case: "capitalized",
    ui: { input: "text", promptKey: "user.givenName" },
  }),

  lastName: field.string({
    required: true,
    minLen: 1,
    maxLen: 80,
    alpha: true,
    case: "capitalized",
    ui: { input: "text", promptKey: "user.lastName" },
  }),

  email: field.string({
    required: true,
    unique: true,
    minLen: 5,
    maxLen: 200,
    format: "email",
    ui: { input: "email", promptKey: "user.email" },
  }),

  phone: field.string({
    required: false,
    unique: true,
    presentByDefault: false,
    format: "phoneDigits",
    ui: { input: "tel", promptKey: "user.phone" },
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

export class DbUserDto extends DtoBase {
  public static dbCollectionName(): string {
    return "user";
  }

  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    { kind: "unique", fields: ["email"], options: { name: "ux_user_email" } },
    {
      kind: "lookup",
      fields: ["lastName", "givenName"],
      options: { name: "ix_user_name" },
    },
  ];

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
        },
    opts?: DtoCtorOpts
  ) {
    super(secretOrMeta);

    this.initCtor(opts, (body, h) => {
      this.hydrateFromBody(body, { validate: h.validate });
    });
  }

  private hydrateFromBody(json: unknown, opts?: { validate?: boolean }): void {
    const unwrapped = unwrapMetaEnvelope(json);
    const j = (unwrapped ?? {}) as Partial<UserJson>;

    const rawId = typeof j._id === "string" ? j._id.trim() : "";
    if (!rawId) {
      throw new Error(
        "DTO_ID_MISSING: DbUserDto hydration requires '_id' (UUIDv4) on the inbound payload."
      );
    }

    this.setIdOnce(validateUUIDString(rawId));

    this.setGivenName(j.givenName, { validate: opts?.validate });
    this.setLastName(j.lastName, { validate: opts?.validate });
    this.setEmail(j.email, { validate: opts?.validate });

    this.setPhone(j.phone);
    this.setHomeLat(j.homeLat);
    this.setHomeLng(j.homeLng);

    this.setAddress1(j.address1);
    this.setAddress2(j.address2);
    this.setCity(j.city);
    this.setState(j.state);
    this.setPcode(j.pcode);
    this.setNotes(j.notes);

    this.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
      ownerUserId: j.ownerUserId,
    });
  }

  public get givenName(): string {
    return this._givenName;
  }

  public setGivenName(value: unknown, opts?: UserFieldOptions): this {
    this._givenName = (value == null ? "" : String(value)).trim();
    if (opts?.validate && !this._givenName) {
      throw new Error("DbUserDto.givenName: field is required.");
    }
    return this;
  }

  public get lastName(): string {
    return this._lastName;
  }

  public setLastName(value: unknown, opts?: UserFieldOptions): this {
    this._lastName = (value == null ? "" : String(value)).trim();
    if (opts?.validate && !this._lastName) {
      throw new Error("DbUserDto.lastName: field is required.");
    }
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

    if (opts?.validate && !raw) {
      throw new Error("DbUserDto.email: field is required.");
    }

    this._email = opts?.validate
      ? assertValidEmail(raw, "DbUserDto.email")
      : raw;
    return this;
  }

  public get phone(): string | undefined {
    return this._phone;
  }

  public setPhone(value: unknown): this {
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

  public setHomeLat(value: unknown): this {
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
    if (Number.isFinite(n)) this._homeLat = n;
    return this;
  }

  public get homeLng(): number | undefined {
    return this._homeLng;
  }

  public setHomeLng(value: unknown): this {
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
    if (Number.isFinite(n)) this._homeLng = n;
    return this;
  }

  public get address1(): string | undefined {
    return this._address1;
  }
  public setAddress1(value: unknown): this {
    this._address1 = this.normalizeOptionalString(value);
    return this;
  }

  public get address2(): string | undefined {
    return this._address2;
  }
  public setAddress2(value: unknown): this {
    this._address2 = this.normalizeOptionalString(value);
    return this;
  }

  public get city(): string | undefined {
    return this._city;
  }
  public setCity(value: unknown): this {
    this._city = this.normalizeOptionalString(value);
    return this;
  }

  public get state(): string | undefined {
    return this._state;
  }
  public setState(value: unknown): this {
    this._state = this.normalizeOptionalString(value);
    return this;
  }

  public get pcode(): string | undefined {
    return this._pcode;
  }
  public setPcode(value: unknown): this {
    this._pcode = this.normalizeOptionalString(value);
    return this;
  }

  public get notes(): string | undefined {
    return this._notes;
  }
  public setNotes(value: unknown): this {
    this._notes = this.normalizeOptionalString(value);
    return this;
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const trimmed =
      typeof value === "string" ? value.trim() : String(value).trim();
    return trimmed.length ? trimmed : undefined;
  }

  public toBody(): UserJson {
    const body: UserJson = {
      _id: this.getId(),
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

  public patchFrom(
    json: Partial<UserJson>,
    opts?: { validate?: boolean }
  ): this {
    if (json.givenName !== undefined)
      this.setGivenName(json.givenName, { validate: opts?.validate });
    if (json.lastName !== undefined)
      this.setLastName(json.lastName, { validate: opts?.validate });
    if (json.email !== undefined)
      this.setEmail(json.email, { validate: opts?.validate });
    if (json.phone !== undefined) this.setPhone(json.phone);
    if (json.homeLat !== undefined) this.setHomeLat(json.homeLat);
    if (json.homeLng !== undefined) this.setHomeLng(json.homeLng);
    if (json.address1 !== undefined) this.setAddress1(json.address1);
    if (json.address2 !== undefined) this.setAddress2(json.address2);
    if (json.city !== undefined) this.setCity(json.city);
    if (json.state !== undefined) this.setState(json.state);
    if (json.pcode !== undefined) this.setPcode(json.pcode);
    if (json.notes !== undefined) this.setNotes(json.notes);
    return this;
  }

  public getType(): string {
    return "user";
  }
}
