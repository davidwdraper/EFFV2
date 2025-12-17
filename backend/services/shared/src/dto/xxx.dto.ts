// backend/services/shared/src/dto/xxx.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 *   - ADR-0053 (Instantiation discipline via BaseDto secret)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable; WARN on overwrite attempt)
 *   - ADR-0078 (DTO write-once private fields; setters in / getters out)
 *   - ADR-0079 (DtoBase.check — single normalization/validation gate)
 *
 * Purpose:
 * - Concrete DTO for the template service ("xxx").
 * - Demonstrates canonical patterns for:
 *   • required string/number fields
 *   • optional contact fields (email, phoneE164)
 *   • ADR-0078 (private fields + getters, no public mutation)
 *   • ADR-0079 (fromBody() via DtoBase.check())
 */

import { DtoBase, type CheckKind } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";
import { StringValidators } from "./validators/StringValidators";
import { NumberValidators } from "./validators/NumberValidators";
import { ContactValidators } from "./validators/ContactValidators";

// Wire-friendly shape
type XxxJson = {
  _id?: string;
  type?: "xxx";

  // Required business fields
  txtfield1: string;
  txtfield2: string;
  numfield1: number;
  numfield2: number;

  // Optional contact fields (examples for validators)
  email?: string;
  phone?: string;

  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class XxxDto extends DtoBase {
  // ─────────────── Collection & Index Hints ───────────────

  public static dbCollectionName(): string {
    return "xxx";
  }

  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    {
      kind: "unique",
      fields: ["txtfield1", "txtfield2", "numfield1", "numfield2"],
      options: { name: "ux_xxx_business" },
    },
    {
      kind: "lookup",
      fields: ["txtfield1"],
      options: { name: "ix_xxx_txtfield1" },
    },
    {
      kind: "lookup",
      fields: ["numfield1"],
      options: { name: "ix_xxx_numfield1" },
    },
    // Contact fields are *not* indexed by default in the template.
  ];

  // ─────────────── Private fields (ADR-0078) ───────────────

  private _txtfield1 = "";
  private _txtfield2 = "";
  private _numfield1 = 0;
  private _numfield2 = 0;

  private _email?: string;
  private _phone?: string;

  // ─────────────── Construction ───────────────

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
    this.setCollectionName(XxxDto.dbCollectionName());
  }

  // ─────────────── Getters (no public fields) ───────────────

  public getTxtfield1(): string {
    return this._txtfield1;
  }

  public getTxtfield2(): string {
    return this._txtfield2;
  }

  public getNumfield1(): number {
    return this._numfield1;
  }

  public getNumfield2(): number {
    return this._numfield2;
  }

  public getEmail(): string | undefined {
    return this._email;
  }

  public getPhone(): string | undefined {
    return this._phone;
  }

  // ─────────────── Setters (for domain code, not raw JSON) ───────────────

  public setTxtfield1(value: string): void {
    this._txtfield1 = value;
  }

  public setTxtfield2(value: string): void {
    this._txtfield2 = value;
  }

  public setNumfield1(value: number): void {
    this._numfield1 = value;
  }

  public setNumfield2(value: number): void {
    this._numfield2 = value;
  }

  public setEmail(value: string | undefined): void {
    this._email = value;
  }

  public setPhone(value: string | undefined): void {
    this._phone = value;
  }

  // ─────────────── Wire hydration (ADR-0079 via DtoBase.check) ───────────────

  public static fromBody(json: unknown, opts?: { validate?: boolean }): XxxDto {
    const dto = new XxxDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<XxxJson>;
    const validate = opts?.validate === true;

    const check = <T>(
      input: unknown,
      kind: CheckKind,
      path: string,
      validator?: (value: T) => void
    ): T =>
      DtoBase.check<T>(input, kind, {
        validate,
        path,
        validator,
      });

    // id (optional; immutable once set)
    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
    }

    // Required strings (non-empty)
    const txtfield1 = check<string>(
      j.txtfield1,
      "string",
      "txtfield1",
      StringValidators.nonEmpty("txtfield1")
    );
    dto.setTxtfield1(txtfield1);

    const txtfield2 = check<string>(
      j.txtfield2,
      "string",
      "txtfield2",
      StringValidators.nonEmpty("txtfield2")
    );
    dto.setTxtfield2(txtfield2);

    // Required numbers (positive ints to keep template simple & safe)
    const numfield1 = check<number>(
      j.numfield1,
      "number",
      "numfield1",
      NumberValidators.positiveInt("numfield1")
    );
    dto.setNumfield1(numfield1);

    const numfield2 = check<number>(
      j.numfield2,
      "number",
      "numfield2",
      NumberValidators.positiveInt("numfield2")
    );
    dto.setNumfield2(numfield2);

    // Optional contact fields (stringOpt + *Opt validators)
    const email = DtoBase.check<string | undefined>(j.email, "stringOpt", {
      validate,
      path: "email",
      validator: ContactValidators.emailOpt("email"),
    });
    dto.setEmail(email);

    const phone = DtoBase.check<string | undefined>(j.phone, "stringOpt", {
      validate,
      path: "phone",
      validator: ContactValidators.phoneE164Opt("phone"),
    });
    dto.setPhone(phone);

    // Meta is hydrated but not validated here (timestamps are opaque strings).
    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    return dto;
  }

  // ─────────────── Outbound wire shape (getters only, ADR-0078) ───────────────

  public toBody(): XxxJson {
    const body: XxxJson = {
      // DO NOT generate id here — DbWriter ensures id BEFORE calling toBody().
      _id: this.hasId() ? this.getId() : undefined,
      type: "xxx",

      txtfield1: this.getTxtfield1(),
      txtfield2: this.getTxtfield2(),
      numfield1: this.getNumfield1(),
      numfield2: this.getNumfield2(),

      email: this.getEmail(),
      phone: this.getPhone(),
    };

    return this._finalizeToJson(body);
  }

  // ─────────────── DTO patch helper (internal, non-validating) ───────────────

  /**
   * Internal patch helper for partial updates.
   *
   * Notes:
   * - Uses DtoBase.check() with validate=false for normalization only.
   * - Callers are responsible for enforcing any additional business rules.
   */
  public patchFrom(json: Partial<XxxJson>): this {
    const j = json;

    const txtfield1 = DtoBase.check<string | undefined>(
      j.txtfield1,
      "stringOpt",
      { validate: false, path: "txtfield1" }
    );
    if (txtfield1 !== undefined) {
      this.setTxtfield1(txtfield1);
    }

    const txtfield2 = DtoBase.check<string | undefined>(
      j.txtfield2,
      "stringOpt",
      { validate: false, path: "txtfield2" }
    );
    if (txtfield2 !== undefined) {
      this.setTxtfield2(txtfield2);
    }

    const numfield1 = DtoBase.check<number | undefined>(
      j.numfield1,
      "numberOpt",
      { validate: false, path: "numfield1" }
    );
    if (numfield1 !== undefined) {
      this.setNumfield1(numfield1);
    }

    const numfield2 = DtoBase.check<number | undefined>(
      j.numfield2,
      "numberOpt",
      { validate: false, path: "numfield2" }
    );
    if (numfield2 !== undefined) {
      this.setNumfield2(numfield2);
    }

    const email = DtoBase.check<string | undefined>(j.email, "stringOpt", {
      validate: false,
      path: "email",
    });
    if (email !== undefined) {
      this.setEmail(email);
    }

    const phone = DtoBase.check<string | undefined>(j.phone, "stringOpt", {
      validate: false,
      path: "phone",
    });
    if (phone !== undefined) {
      this.setPhone(phone);
    }

    return this;
  }

  // ─────────────── IDto contract ───────────────

  public getType(): string {
    return "xxx";
  }
}
