// backend/services/shared/src/dto/templates/xxx/xxx.dto.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; single toJson() exit
 * - ADRs:
 *   - ADR-0015 (DTO-First Development)
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *
 * Purpose:
 * - Xxx DTO for the t_entity_crud template.
 * - Meta stamping is done by BaseDto._finalizeToJson() INSIDE toJson().
 */

import { z } from "zod";
import { BaseDto, DtoValidationError } from "../../DtoBase";
import type { IndexHint } from "../../persistence/index-hints";

const _schema = z.object({
  _id: z.string().min(1).optional(),
  txtfield1: z.string().min(1, "txtfield1 required"),
  txtfield2: z.string().min(1, "txtfield2 required"),
  numfield1: z.number(),
  numfield2: z.number(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  updatedByUserId: z.string().optional(),
});

const _patchSchema = z
  .object({
    txtfield1: z.string().optional(),
    txtfield2: z.string().optional(),
    numfield1: z.number().optional(),
    numfield2: z.number().optional(),
  })
  .strict();

type _State = z.infer<typeof _schema>;
type _Patch = z.infer<typeof _patchSchema>;

export class XxxDto extends BaseDto {
  private _state: Omit<
    _State,
    "_id" | "createdAt" | "updatedAt" | "updatedByUserId"
  >;

  static indexHints: ReadonlyArray<IndexHint> = [
    { kind: "lookup", fields: ["txtfield1"] },
    { kind: "lookup", fields: ["numfield1", "numfield2"] },
    {
      kind: "unique",
      fields: ["txtfield2"],
      options: { name: "uniq_txtfield2" },
    },
  ];

  private constructor(validated: _State) {
    super({
      id: validated._id,
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
      updatedByUserId: validated.updatedByUserId,
    });
    const { _id, createdAt, updatedAt, updatedByUserId, ...rest } = validated;
    this._state = rest;
  }

  public static create(input: unknown): XxxDto {
    const parsed = _schema.safeParse(input);
    if (!parsed.success) {
      throw new DtoValidationError(
        "Invalid Xxx payload. Ops: verify client/body mapper; all four fields required (two strings, two numbers).",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        }))
      );
    }
    return new XxxDto(parsed.data);
  }

  public static fromJson(json: unknown): XxxDto;
  public static fromJson(json: unknown, opts: { validate: boolean }): XxxDto;
  public static fromJson(json: unknown, opts?: { validate: boolean }): XxxDto {
    const validate = opts?.validate !== false;
    if (validate) {
      const parsed = _schema.safeParse(json);
      if (!parsed.success) {
        throw new DtoValidationError(
          "Invalid Xxx payload. Ops: validate client/body mapper; ensure required fields and types.",
          parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            code: i.code,
            message: i.message,
          }))
        );
      }
      return new XxxDto(parsed.data);
    }
    const parsed = _schema.parse(json);
    return new XxxDto(parsed);
  }

  // Friendly id
  public get xxxId(): string | undefined {
    return (this as unknown as { _internalId?: string })._internalId;
  }

  // Getters
  public get txtfield1(): string {
    return this._state.txtfield1;
  }
  public get txtfield2(): string {
    return this._state.txtfield2;
  }
  public get numfield1(): number {
    return this._state.numfield1;
  }
  public get numfield2(): number {
    return this._state.numfield2;
  }

  // Mutations
  public updateFrom(other: this): this {
    return this._mutate({
      txtfield1: other._state.txtfield1,
      txtfield2: other._state.txtfield2,
      numfield1: other._state.numfield1,
      numfield2: other._state.numfield2,
    });
  }
  public patchFrom(json: unknown): this {
    const parsed = _patchSchema.safeParse(json);
    if (!parsed.success) {
      throw new DtoValidationError(
        "Xxx patch rejected. Ops: unknown field or type mismatch.",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        }))
      );
    }
    const p: _Patch = parsed.data;
    return this._mutate({
      ...(p.txtfield1 !== undefined && { txtfield1: p.txtfield1 }),
      ...(p.txtfield2 !== undefined && { txtfield2: p.txtfield2 }),
      ...(p.numfield1 !== undefined && { numfield1: p.numfield1 }),
      ...(p.numfield2 !== undefined && { numfield2: p.numfield2 }),
    });
  }

  /**
   * Single outbound path — stamps meta **here**:
   * - set createdAt if missing
   * - always refresh updatedAt
   * - ensure updatedByUserId (default until auth arrives)
   */
  public toJson(): unknown {
    return this._finalizeToJson({
      txtfield1: this._state.txtfield1,
      txtfield2: this._state.txtfield2,
      numfield1: this._state.numfield1,
      numfield2: this._state.numfield2,
    });
  }

  // Internals
  private _mutate(
    patch: Partial<
      Pick<_State, "txtfield1" | "txtfield2" | "numfield1" | "numfield2">
    >
  ): this {
    const nextCandidate = { ...this._state, ...patch } as Record<
      string,
      unknown
    >;
    const composed = this._composeForValidation(nextCandidate);
    const parsed = _schema.safeParse(composed);
    if (!parsed.success) {
      throw new DtoValidationError(
        "Xxx mutation rejected. Ops: verify field types and constraints.",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        }))
      );
    }
    const rest = this._extractMetaAndId(parsed.data);
    this._state = rest as typeof this._state;
    return this;
  }
}
