// backend/services/shared/src/dto/templates/xxx/xxx.dto.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; single toJson() exit
 * - ADRs:
 *   - ADR-0015 (DTO-First Development)
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)  // collection no longer from env
 *   - ADR-0047 (DtoBag — pk & filter shaping live in DTO space)
 *   - ADR-0048 (pk mapping at persistence edge)
 *   - ADR-0049 (DTO Registry; canonical string id; wire vs db modes)
 *
 * Policy (updated):
 * - DTOs NEVER expose Mongo `_id`. Canonical id is `id: string`.
 * - In mode:"wire", if `id` is absent, the DTO generates a canonical id.
 * - In mode:"db", `id` is required (DbReader must supply it after mapping).
 * - Patching occurs via schema-validated field setters; `id` is immutable.
 * - Collection name is hard-wired per DTO class (DB-agnostic), lives beside indexHints.
 */

import { z } from "zod";
import { BaseDto, DtoValidationError } from "../../DtoBase";
import type { IndexHint } from "../../persistence/index-hints";
import type { IDto } from "../../IDto";
import { newId as makeId } from "../../../id/IdFactory";

// ----- Wire & patch schemas -------------------------------------------------

const _wireSchema = z.object({
  id: z.string().min(1).optional(), // optional in mode:"wire" (will be synthesized)
  type: z.literal("xxx").optional(), // normalized by DTO; tolerated inbound
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

type _State = z.infer<typeof _wireSchema>;
type _Patch = z.infer<typeof _patchSchema>;

// ----- DTO ------------------------------------------------------------------

export class XxxDto extends BaseDto implements IDto {
  /** DB-agnostic, class-level collection binding (cloner replaces "xxx-values"). */
  public static dbCollectionName(): string {
    return "xxx-values";
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

  // Canonical ID and internal state (no public fields)
  private _id: string;
  private _state: Omit<
    _State,
    "id" | "type" | "createdAt" | "updatedAt" | "updatedByUserId"
  >;

  private constructor(validated: _State) {
    super({
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
      updatedByUserId: validated.updatedByUserId,
    });
    const {
      id,
      createdAt,
      updatedAt,
      updatedByUserId,
      type: _t,
      ...rest
    } = validated;
    // id must be set by factory semantics prior to calling ctor
    this._id = id as string;
    this._state = rest;
  }

  // ----- IDto surface -------------------------------------------------------

  public getId(): string {
    return this._id;
  }

  /** Wire discriminator for registry/bag. */
  public getType(): string {
    return "xxx";
  }

  /**
   * Defensive copy for rare _id collisions: clone with new id (or supplied one).
   * Bypasses validation (source already valid) and resets meta timestamps.
   */
  public clone(newId?: string): this {
    const json = this.toJson() as _State & { type?: string };
    json.id = newId ?? makeId();
    json.type = "xxx";
    return XxxDto.fromJson(json, { validate: false }) as this;
  }

  // ----- Factory / hydration ------------------------------------------------

  /**
   * Hydrate from JSON. Options:
   * - mode:"wire"  → `id` optional; synthesized if missing
   * - mode:"db"    → `id` required
   * - validate     → default true
   */
  public static fromJson(json: unknown): XxxDto;
  public static fromJson(
    json: unknown,
    opts: { mode?: "wire" | "db"; validate?: boolean }
  ): XxxDto;
  public static fromJson(
    json: unknown,
    opts?: { mode?: "wire" | "db"; validate?: boolean }
  ): XxxDto {
    const mode = opts?.mode ?? "wire";
    const doValidate = opts?.validate !== false;

    const data = typeof json === "string" ? JSON.parse(json) : (json as object);

    if (doValidate) {
      const parsed = _wireSchema.safeParse(data);
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
      const wire = parsed.data;

      if (mode === "db") {
        if (!wire.id || wire.id.trim() === "") {
          throw new DtoValidationError("Missing required id in db mode.", [
            {
              path: "id",
              code: "custom",
              message: "id is required in db mode",
            },
          ]);
        }
        return new XxxDto({ ...wire, id: wire.id, type: "xxx" });
      } else {
        const id = wire.id && wire.id.trim() !== "" ? wire.id : makeId();
        return new XxxDto({ ...wire, id, type: "xxx" });
      }
    }

    // validate:false path (internal, used by clone)
    const loose = data as _State;
    const id =
      mode === "db"
        ? (loose.id as string)
        : loose.id && loose.id.trim() !== ""
        ? loose.id
        : makeId();
    return new XxxDto({ ...loose, id, type: "xxx" });
  }

  // ----- Accessors (no setters; patch via patchFrom) ------------------------

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

  // ----- Mutations (schema-validated; id is immutable) ----------------------

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
      id: this._id,
      type: "xxx",
      ...nextCandidate,
    });
    const parsed = _wireSchema.safeParse(composed);
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
    const {
      id,
      createdAt,
      updatedAt,
      updatedByUserId,
      type: _t,
      ...rest
    } = parsed.data;
    // id is immutable; keep existing
    this._state = rest as typeof this._state;
    return this;
  }

  // ----- Serialization ------------------------------------------------------

  public toJson(): unknown {
    return this._finalizeToJson({
      id: this._id,
      type: "xxx",
      txtfield1: this._state.txtfield1,
      txtfield2: this._state.txtfield2,
      numfield1: this._state.numfield1,
      numfield2: this._state.numfield2,
    });
  }
}
