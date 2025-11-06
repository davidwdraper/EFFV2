// backend/services/shared/src/dto/templates/xxx/xxx.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *   - ADR-0053 (Instantiation discipline via BaseDto secret)
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
 *
 * Index Hint kinds supported (examples in comments below):
 * - "unique"  → unique compound or single-field index (e.g., { kind:"unique", fields:["id"] })
 * - "lookup"  → non-unique ascending fields (e.g., { kind:"lookup", fields:["txtfield1","numfield1"] })
 * - "text"    → MongoDB text index over fields (e.g., { kind:"text", fields:["txtfield1","txtfield2"] })
 * - "ttl"     → time-to-live on a single field (e.g., { kind:"ttl", field:"expiresAt", seconds:3600 })
 * - "hash"    → hashed index on exactly one field (e.g., { kind:"hash", fields:["id"] })
 */

import { BaseDto } from "../../DtoBase";
import type { IndexHint } from "../../persistence/index-hints";

// Keep the wire-friendly shape nearby for clarity (not exported if you prefer)
type XxxJson = {
  id?: string; // canonical id (wire, ADR-0050)
  type?: "xxx"; // dtoType (wire)
  txtfield1: string;
  txtfield2: string;
  numfield1: number;
  numfield2: number;
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class XxxDto extends BaseDto {
  // ─────────────── Static: Collection & Index Hints ───────────────

  /** Hardwired collection for this DTO. Registry seeds instances with this once. */
  public static dbCollectionName(): string {
    return "xxx";
  }

  /**
   * Deterministic index hints consumed at boot by ensureIndexesForDtos().
   * - Unique on canonical wire id ("id") so duplicates return 409.
   * - Lookup indexes on txtfield1 (string) and numfield1 (number).
   * - Additional examples of supported kinds are shown below as commented hints.
   */
  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    // Fast non-unique lookups
    { kind: "lookup", fields: ["txtfield1"] },
    { kind: "lookup", fields: ["numfield1"] },

    // ——— Examples (uncomment if/when needed) ———
    // { kind: "text", fields: ["txtfield1", "txtfield2"] },
    // { kind: "ttl", field: "expiresAt", seconds: 3600 },
    // { kind: "hash", fields: ["id"] }, // exactly one field required
  ];

  // ─────────────── Instance: Domain Fields ───────────────

  public id?: string;
  public txtfield1 = "";
  public txtfield2 = "";
  public numfield1 = 0;
  public numfield2 = 0;

  /**
   * Accepts either the BaseDto secret (Registry path) OR meta (fromJson path).
   * This matches BaseDto’s `(secretOrArgs?: symbol | _DtoMeta)` contract.
   */
  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
  }

  /** Wire hydration (validation hook lives here if you enable it). */
  public static fromJson(json: unknown, opts?: { validate?: boolean }): XxxDto {
    const dto = new XxxDto(BaseDto.getSecret());

    // Minimal parse/assign; plug Zod here if opts?.validate is true
    const j = (json ?? {}) as Partial<XxxJson>;
    if (typeof j.id === "string" && j.id.trim()) dto.id = j.id.trim();
    if (typeof j.txtfield1 === "string") dto.txtfield1 = j.txtfield1;
    if (typeof j.txtfield2 === "string") dto.txtfield2 = j.txtfield2;
    if (typeof j.numfield1 === "number")
      dto.numfield1 = Math.trunc(j.numfield1);
    if (typeof j.numfield2 === "number")
      dto.numfield2 = Math.trunc(j.numfield2);

    // If meta is present on wire, capture it (BaseDto will normalize on toJson)
    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    return dto;
  }

  /** Canonical outbound wire shape; BaseDto stamps meta here. */
  public toJson(): XxxJson {
    const body = {
      id: this.id,
      type: "xxx" as const, // wire type (matches slug)
      txtfield1: this.txtfield1,
      txtfield2: this.txtfield2,
      numfield1: this.numfield1,
      numfield2: this.numfield2,
    };
    // Let BaseDto finalize meta stamping
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
}
