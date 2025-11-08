// backend/services/shared/src/dto/templates/xxx/xxx.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
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
 *     • If wire provides id → BaseDto setter validates UUIDv4 and stores lowercase.
 *     • If absent → DbWriter will generate **before** calling toJson().
 *     • toJson() never invents or mutates id (no ID insertion during/after toJson).
 */

import { BaseDto } from "../../DtoBase";
import type { IndexHint } from "../../persistence/index-hints";
import type { IDto } from "../../IDto"; // ← added
import { randomUUID } from "crypto";

// Wire-friendly shape (for clarity)
type XxxJson = {
  id?: string; // canonical id (wire, ADR-0050); stored as Mongo _id (string) by adapter
  type?: "xxx"; // dtoType (wire)
  txtfield1: string;
  txtfield2: string;
  numfield1: number;
  numfield2: number;
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class XxxDto extends BaseDto implements IDto {
  // ← implements IDto
  // ─────────────── Static: Collection & Index Hints ───────────────

  /** Hardwired collection for this DTO. Registry seeds instances with this once. */
  public static dbCollectionName(): string {
    return "xxx";
  }

  /**
   * Deterministic index hints consumed at boot by ensureIndexesForDtos().
   * NOTE: We do NOT index "id" here because the Mongo adapter maps { id → _id } and
   * Mongo guarantees uniqueness on _id by default.
   */
  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    { kind: "lookup", fields: ["txtfield1"] },
    { kind: "lookup", fields: ["numfield1"] },
    // Examples:
    // { kind: "text", fields: ["txtfield1", "txtfield2"] },
    // { kind: "ttl", field: "expiresAt", seconds: 3600 },
    // { kind: "hash", fields: ["txtfield1"] },
  ];

  // ─────────────── Instance: Domain Fields ───────────────
  // IMPORTANT: Do NOT declare a public `id` field here — it would shadow BaseDto.id.
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

  /** Wire hydration (plug Zod here when opts?.validate is true). */
  public static fromJson(json: unknown, opts?: { validate?: boolean }): XxxDto {
    const dto = new XxxDto(BaseDto.getSecret());

    // Minimal parse/assign
    const j = (json ?? {}) as Partial<XxxJson>;
    if (typeof j.id === "string" && j.id.trim()) {
      // BaseDto setter validates UUIDv4 & lowercases; immutable after first set.
      dto.id = j.id.trim();
    }
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
    // NO id generation here — DbWriter ensures id BEFORE calling toJson().
    const body = {
      id: this.id, // getter throws if not set; DbWriter guarantees presence on create
      type: "xxx" as const, // wire type (matches slug)
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

  // ─────────────── IDto contract (added) ───────────────
  /** Canonical DTO type key (registry key). */
  public getType(): string {
    return "xxx";
  }

  /** Canonical DTO id. */
  public getId(): string {
    return this.id;
  }

  // inside backend/services/shared/src/dto/templates/xxx/xxx.dto.ts

  /**
   * Deep clone as a new instance with a NEW UUIDv4 id (ADR-0057).
   * - Preserves current DTO fields and meta.
   * - Re-seeds the instance collection to match the source.
   */
  // inside backend/services/shared/src/dto/templates/xxx/xxx.dto.ts
  public clone(newId?: string): this {
    // Use the concrete class constructor type (not an inline `this` type)
    const Ctor = this.constructor as typeof XxxDto;

    // Rehydrate from current wire state (no revalidation)
    const next = Ctor.fromJson(this.toJson(), { validate: false }) as this;

    // Assign NEW id (or supplied override)
    (next as any).id = newId ?? randomUUID();

    // Preserve instance collection to avoid DTO_COLLECTION_UNSET
    const coll = (this as any).getCollectionName?.() ?? Ctor.dbCollectionName();
    if (coll && typeof (next as any).setCollectionName === "function") {
      (next as any).setCollectionName(coll);
    }

    return next;
  }
}
