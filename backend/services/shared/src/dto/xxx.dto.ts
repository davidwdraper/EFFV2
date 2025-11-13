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
 *
 * Purpose:
 * - Concrete DTO for the template service ("xxx").
 * - Constructor accepts the same union as BaseDto: (secret | meta), so the Registry
 *   can pass the instantiation secret, and fromJson() can pass meta when hydrating.
 *
 * Notes:
 * - Instance collection is seeded by the Registry via setCollectionName().
 * - dbCollectionName() returns the hardwired collection for this DTO.
 * - indexHints declare deterministic indexes to be ensured at boot.
 * - ID lifecycle:
 *     • Wire always uses `_id` (UUIDv4 string, lowercase).
 *     • DbWriter generates id BEFORE toJson() when absent.
 *     • No legacy `id` tolerance — strictly `_id` on input/output.
 */

import { DtoBase } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";
import type { IDto } from "./IDto";

// Wire-friendly shape
type XxxJson = {
  _id?: string; // canonical wire id
  type?: "xxx";
  txtfield1: string;
  txtfield2: string;
  numfield1: number;
  numfield2: number;
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class XxxDto extends DtoBase implements IDto {
  /** Hardwired collection for this DTO. */
  public static dbCollectionName(): string {
    return "xxx";
  }

  /**
   * Deterministic index hints consumed at boot by ensureIndexesForDtos().
   * Business duplicate-by-content is enforced via a compound **unique** index.
   */
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
  ];

  // ─────────────── Instance: Domain Fields ───────────────
  public txtfield1 = "";
  public txtfield2 = "";
  public numfield1 = 0;
  public numfield2 = 0;

  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
  }

  /** Wire hydration (strict `_id` only). */
  public static fromJson(json: unknown, opts?: { validate?: boolean }): XxxDto {
    const dto = new XxxDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<XxxJson>;

    if (typeof j._id === "string" && j._id.trim()) {
      // BaseDto setter validates UUIDv4 & lowercases; immutable after first set.
      dto.id = j._id.trim();
    }

    if (typeof j.txtfield1 === "string") dto.txtfield1 = j.txtfield1;
    if (typeof j.txtfield2 === "string") dto.txtfield2 = j.txtfield2;
    if (typeof j.numfield1 === "number")
      dto.numfield1 = Math.trunc(j.numfield1);
    if (typeof j.numfield2 === "number")
      dto.numfield2 = Math.trunc(j.numfield2);

    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    return dto;
  }

  /** Canonical outbound wire shape; BaseDto stamps meta here. */
  public toJson(): XxxJson {
    // DO NOT generate id here — DbWriter ensures id BEFORE calling toJson().
    const body = {
      _id: super.id, // emit `_id` on wire
      type: "xxx" as const,
      txtfield1: this.txtfield1,
      txtfield2: this.txtfield2,
      numfield1: this.numfield1,
      numfield2: this.numfield2,
    };
    return this._finalizeToJson(body);
  }

  /** Optional patch helper used by update pipelines. */
  public patchFrom(json: Partial<XxxJson>): this {
    if (json.txtfield1 !== undefined && typeof json.txtfield1 === "string") {
      this.txtfield1 = json.txtfield1;
    }
    if (json.txtfield2 !== undefined && typeof json.txtfield2 === "string") {
      this.txtfield2 = json.txtfield2;
    }
    if (json.numfield1 !== undefined) {
      const n =
        typeof json.numfield1 === "string"
          ? Number(json.numfield1)
          : json.numfield1;
      if (Number.isFinite(n)) this.numfield1 = Math.trunc(n as number);
    }
    if (json.numfield2 !== undefined) {
      const n =
        typeof json.numfield2 === "string"
          ? Number(json.numfield2)
          : json.numfield2;
      if (Number.isFinite(n)) this.numfield2 = Math.trunc(n as number);
    }
    return this;
  }

  // ─────────────── IDto contract ───────────────
  public getType(): string {
    return "xxx";
  }
  public getId(): string {
    return super.id;
  }
}
