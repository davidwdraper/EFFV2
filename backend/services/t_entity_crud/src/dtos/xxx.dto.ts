// backend/services/t_entity_crud/src/dtos/xxx.dto.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0015 (DTO-First Development)
 *
 * Purpose:
 * - Xxx DTO: sole contract + validator for the t_entity_crud template.
 * - Encapsulates data entirely; exposes only getters and toJson().
 *
 * Invariants:
 * - DB primary key is stored internally as _id; when exposed, use getter xxxId.
 * - No exported internal state, schemas, or types.
 */

import { z } from "zod";
import { BaseDto, DtoValidationError } from "@nv/shared/dto/base.dto";

// Internal-only schema (includes _id + meta so persistence can hydrate seamlessly)
const _schema = z.object({
  _id: z.string().min(1).optional(), // DB gospel; internal only
  txtfield1: z.string().min(1, "txtfield1 required"),
  txtfield2: z.string().min(1, "txtfield2 required"),
  numfield1: z.number(),
  numfield2: z.number(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  updatedByUserId: z.string().optional(),
});

// Internal state shape (NOT exported)
type _State = z.infer<typeof _schema>;

export class XxxDto extends BaseDto {
  private _state: Omit<
    _State,
    "_id" | "createdAt" | "updatedAt" | "updatedByUserId"
  >;

  private constructor(validated: _State) {
    // Base stores id/meta; we keep the entity fields sealed in _state
    super({
      id: validated._id,
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
      updatedByUserId: validated.updatedByUserId,
    });
    const { _id, createdAt, updatedAt, updatedByUserId, ...rest } = validated;
    this._state = rest;
  }

  /** Factory from untrusted input (controller/service boundary). */
  public static create(input: unknown): XxxDto {
    const parsed = _schema.safeParse(input);
    if (!parsed.success) {
      throw new DtoValidationError(
        "Invalid Xxx payload. Ops: validate client/body mapper; ensure all four fields exist and are typed correctly (two strings, two numbers).",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        })),
        "Ops: If this came from the API, inspect request logs with x-request-id; if from DB, run a sample findOne() and compare document against DTO rules."
      );
    }
    return new XxxDto(parsed.data);
  }

  /** Hydrate from persistence or wire JSON (same schema authority). */
  public static fromJson(json: unknown): XxxDto {
    return XxxDto.create(json);
  }

  // ---- ID exposure policy ----
  /** Public-facing primary key alias (keeps multi-DTO responses unambiguous). */
  public get xxxId(): string | undefined {
    // Map the internal DB _id to the exposed alias
    // (We deliberately DO NOT expose a generic 'id' getter.)
    const id = (this as unknown as { _internalId?: string })._internalId;
    return id;
  }

  // ---- Field getters ----
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

  // ---- Narrow mutators (all paths revalidate through the schema) ----
  public setTxtfield1(v: string): this {
    return this._mutate({ txtfield1: v });
  }
  public setTxtfield2(v: string): this {
    return this._mutate({ txtfield2: v });
  }
  public setNumfield1(v: number): this {
    return this._mutate({ numfield1: v });
  }
  public setNumfield2(v: number): this {
    return this._mutate({ numfield2: v });
  }

  /** Serialize for DB/FS/wire. */
  public toJson(): unknown {
    return this._withMeta({
      txtfield1: this._state.txtfield1,
      txtfield2: this._state.txtfield2,
      numfield1: this._state.numfield1,
      numfield2: this._state.numfield2,
    });
  }

  // ---- Internals ----

  /** Single, drift-free mutation path using BaseDto helpers for meta/id. */
  private _mutate(
    patch: Partial<
      Pick<_State, "txtfield1" | "txtfield2" | "numfield1" | "numfield2">
    >
  ): this {
    const nextCandidate = {
      ...this._state,
      ...patch,
    } as Record<string, unknown>;

    // Compose with current id/meta, validate once, then re-extract id/meta
    const composed = this._composeForValidation(nextCandidate);
    const parsed = _schema.safeParse(composed);
    if (!parsed.success) {
      throw new DtoValidationError(
        "Xxx mutation rejected by DTO. Ops: verify field types and constraints; see issues for the specific field(s).",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        })),
        "Ops: If mutations come from a controller, confirm input mapping; if internal service logic, inspect the last write and ensure invariants are preserved."
      );
    }

    const rest = this._extractMetaAndId(parsed.data);
    this._state = rest as typeof this._state;
    return this;
  }
}
