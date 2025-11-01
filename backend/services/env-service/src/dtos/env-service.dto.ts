// backend/services/shared/src/dto/templates/env-service/env-service.dto.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; single toJson() exit
 * - ADRs:
 *   - ADR-0015 (DTO-First Development)
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0047 (DtoBag — pk & filter shaping live in DTO space)
 *   - ADR-0048 (pk mapping at persistence edge)
 *
 * Policy:
 * - DTOs NEVER expose `_id`. Canonical id on the surface is `envServiceId` (string).
 * - DbWriter/DbReader handle `_id<ObjectId>` ⇄ `envServiceId<string>` mapping at the edge.
 */

import { z } from "zod";
import { BaseDto, DtoValidationError } from "../../DtoBase";
import type { IndexHint } from "../../persistence/index-hints";

const _schema = z.object({
  envServiceId: z.string().min(1).optional(),
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

export class EnvServiceDto extends BaseDto {
  /** Virtual by convention: cloner renames the value to service-specific key. */
  public static dbCollectionKey(): string {
    return "NV_COLLECTION_ENV_SERVICE_VALUES";
  }

  static indexHints: ReadonlyArray<IndexHint> = [
    { kind: "lookup", fields: ["txtfield1"] },
    { kind: "lookup", fields: ["numfield1", "numfield2"] },
    {
      kind: "unique",
      fields: ["txtfield2"],
      options: { name: "uniq_txtfield2" },
    },
  ];

  private _xxxId?: string;
  private _state: Omit<
    _State,
    "envServiceId" | "createdAt" | "updatedAt" | "updatedByUserId"
  >;

  private constructor(validated: _State) {
    super({
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
      updatedByUserId: validated.updatedByUserId,
    });
    const { envServiceId, createdAt, updatedAt, updatedByUserId, ...rest } = validated;
    this._xxxId = envServiceId;
    this._state = rest;
  }

  public static create(input: unknown): EnvServiceDto {
    const parsed = _schema.safeParse(input);
    if (!parsed.success) {
      throw new DtoValidationError(
        "Invalid EnvService payload. Ops: verify client/body mapper; all four fields required (two strings, two numbers).",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        }))
      );
    }
    return new EnvServiceDto(parsed.data);
  }

  public static fromJson(json: unknown): EnvServiceDto;
  public static fromJson(json: unknown, opts: { validate: boolean }): EnvServiceDto;
  public static fromJson(json: unknown, opts?: { validate: boolean }): EnvServiceDto {
    const doValidate = opts?.validate !== false;
    if (doValidate) {
      const parsed = _schema.safeParse(json);
      if (!parsed.success) {
        throw new DtoValidationError(
          "Invalid EnvService payload. Ops: validate client/body mapper; ensure required fields and types.",
          parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            code: i.code,
            message: i.message,
          }))
        );
      }
      return new EnvServiceDto(parsed.data);
    }
    return new EnvServiceDto(json as _State);
  }

  // Canonical DTO-space id (string). Never expose Mongo `_id` here.
  public get envServiceId(): string | undefined {
    return this._xxxId;
  }

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
        "EnvService patch rejected. Ops: unknown field or type mismatch.",
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

  public toJson(): unknown {
    return this._finalizeToJson({
      ...(this._xxxId ? { envServiceId: this._xxxId } : {}),
      txtfield1: this._state.txtfield1,
      txtfield2: this._state.txtfield2,
      numfield1: this._state.numfield1,
      numfield2: this._state.numfield2,
    });
  }

  private _mutate(
    patch: Partial<
      Pick<_State, "txtfield1" | "txtfield2" | "numfield1" | "numfield2">
    >
  ): this {
    const nextCandidate = { ...this._state, ...patch } as Record<
      string,
      unknown
    >;
    const composed = this._composeForValidation({
      ...(this._xxxId ? { envServiceId: this._xxxId } : {}),
      ...nextCandidate,
    });
    const parsed = _schema.safeParse(composed);
    if (!parsed.success) {
      throw new DtoValidationError(
        "EnvService mutation rejected. Ops: verify field types and constraints.",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        }))
      );
    }
    const { envServiceId, createdAt, updatedAt, updatedByUserId, ...rest } =
      parsed.data;
    this._xxxId = envServiceId ?? this._xxxId;
    this._state = rest as typeof this._state;
    return this;
  }

  // Convenience for callers that want the collection at class level:
  public static dbCollectionName(): string {
    return BaseDto.dbCollectionName.call(this);
  }
}
