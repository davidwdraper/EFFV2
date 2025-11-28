// backend/services/shared/src/dto/gateway.dto.ts
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
 * - Concrete DTO for the template service ("gateway").
 */

import { DtoBase } from "./DtoBase";
import type { IndexHint } from "./persistence/index-hints";

// Wire-friendly shape
type GatewayJson = {
  _id?: string;
  type?: "gateway";
  txtfield1: string;
  txtfield2: string;
  numfield1: number;
  numfield2: number;
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class GatewayDto extends DtoBase {
  public static dbCollectionName(): string {
    return "gateway";
  }

  public static readonly indexHints: ReadonlyArray<IndexHint> = [
    {
      kind: "unique",
      fields: ["txtfield1", "txtfield2", "numfield1", "numfield2"],
      options: { name: "ux_gateway_business" },
    },
    {
      kind: "lookup",
      fields: ["txtfield1"],
      options: { name: "ix_gateway_txtfield1" },
    },
    {
      kind: "lookup",
      fields: ["numfield1"],
      options: { name: "ix_gateway_numfield1" },
    },
  ];

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

  public static fromJson(
    json: unknown,
    opts?: { validate?: boolean }
  ): GatewayDto {
    const dto = new GatewayDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<GatewayJson>;

    if (typeof j._id === "string" && j._id.trim()) {
      dto.setIdOnce(j._id.trim());
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

    // opts?.validate hook can wire in Zod later if needed.

    return dto;
  }

  public toJson(): GatewayJson {
    const body: GatewayJson = {
      // DO NOT generate id here — DbWriter ensures id BEFORE calling toJson().
      _id: this.hasId() ? this.getId() : undefined,
      type: "gateway",
      txtfield1: this.txtfield1,
      txtfield2: this.txtfield2,
      numfield1: this.numfield1,
      numfield2: this.numfield2,
    };
    return this._finalizeToJson(body);
  }

  public patchFrom(json: Partial<GatewayJson>): this {
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

  public getType(): string {
    return "gateway";
  }
}
