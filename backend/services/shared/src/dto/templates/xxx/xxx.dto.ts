// backend/services/shared/src/dto/templates/xxx/xxx.dto.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0015 (DTO-First Development)
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *
 * Purpose:
 * - Xxx DTO: canonical contract + validator for the t_entity_crud template.
 * - Encapsulates data and validation; exposes only getters and toJson().
 * - Declares static IndexHints so ControllerBase can ensure DB indexes at boot.
 *
 * Invariants:
 * - DTOs are persistence-agnostic. They never import Mongo/DB logic directly.
 * - IndexHints are abstract (lookup/unique/text/ttl) and translated by adapters.
 * - _id is internal; exposed alias is xxxId for clarity.
 *
 * Notes:
 * - Inside the shared package, use **relative** imports (no @nv/shared).
 */

import { z } from "zod";
import { BaseDto, DtoValidationError } from "../../base.dto";
import type { IndexHint } from "../../persistence/index-hints";

// Internal-only schema (includes _id + meta so persistence can hydrate seamlessly)
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

// Internal state shape (NOT exported)
type _State = z.infer<typeof _schema>;

export class XxxDto extends BaseDto {
  private _state: Omit<
    _State,
    "_id" | "createdAt" | "updatedAt" | "updatedByUserId"
  >;

  // ---- Index hints (DB-agnostic; consumed at boot by ControllerBase) ----
  static indexHints = [
    { kind: "lookup", fields: ["txtfield1"] },
    { kind: "lookup", fields: ["numfield1", "numfield2"] },
    {
      kind: "unique",
      fields: ["txtfield2"],
      options: { name: "uniq_txtfield2" },
    },
    // { kind: "text", fields: ["txtfield1", "txtfield2"] },
    // { kind: "ttl", field: "createdAt", seconds: 60 * 60 * 24 },
  ] as const;

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

  /** Factory from untrusted input (controller/service boundary). */
  public static create(input: unknown): XxxDto {
    const parsed = _schema.safeParse(input);
    if (!parsed.success) {
      throw new DtoValidationError(
        "Invalid Xxx payload. Ops: verify client/body mapper; all four fields required (two strings, two numbers).",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        })),
        "Ops: If this came from the API, inspect logs with x-request-id; if from DB, compare document to DTO rules."
      );
    }
    return new XxxDto(parsed.data);
  }

  /**
   * Hydrate from persistence or wire JSON (same schema authority).
   * Overloads preserve BaseDto static compatibility while allowing validate flag.
   */
  public static fromJson(json: unknown): XxxDto;
  public static fromJson(json: unknown, opts: { validate: boolean }): XxxDto;
  public static fromJson(json: unknown, opts?: { validate: boolean }): XxxDto {
    const validate = opts?.validate !== false; // default to true for ingress safety

    if (validate) {
      const parsed = _schema.safeParse(json);
      if (!parsed.success) {
        throw new DtoValidationError(
          "Invalid Xxx payload. Ops: validate client/body mapper; ensure required fields and types.",
          parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            code: i.code,
            message: i.message,
          })),
          "Ops: Check request logs with x-request-id or compare persisted doc against DTO rules."
        );
      }
      return new XxxDto(parsed.data);
    }

    // Trusted hydration path (e.g., DB/WAL/FS) — skip redundant safeParse cost
    const parsed = _schema.parse(json);
    return new XxxDto(parsed);
  }

  // ---- ID exposure ----
  public get xxxId(): string | undefined {
    return (this as unknown as { _internalId?: string })._internalId;
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

  // ---- Narrow mutators (all paths revalidate via schema) ----
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
        })),
        "Ops: If from controller, confirm input mapping; if internal, inspect last write and ensure invariants."
      );
    }

    const rest = this._extractMetaAndId(parsed.data);
    this._state = rest as typeof this._state;
    return this;
  }
}
