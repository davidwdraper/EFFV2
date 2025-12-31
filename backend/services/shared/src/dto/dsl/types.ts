// backend/services/shared/src/dto/dsl/types.ts
/**
 * Docs:
 * - SOP: DTO-first; meta must never leak into canonical DTO bodies.
 * - ADRs:
 *   - ADR-0089 (DTO Field DSL with Meta Envelope)
 *   - ADR-0090 (DTO Field DSL Design + Non-Breaking Integration)
 *
 * Purpose:
 * - Shared types for the DTO Field DSL.
 * - Must remain small, closed, and serializable-ish (plain objects; no closures required).
 *
 * UI Rule (Option B):
 * - DTOs do NOT encode UX scopes (auth.signup, venue.claim, etc.).
 * - DTOs MAY provide a canonical promptKey (e.g., "user.phone").
 * - Consumers may prepend scope or override prompt keys outside the DTO.
 */

export type FieldKind =
  | "string"
  | "number"
  | "boolean"
  | "literal"
  | "enum"
  | "array"
  | "object"
  | "union";

export type FieldUiMeta = {
  /**
   * Canonical prompt identity for this field.
   * Example: "user.phone" → consumer derives:
   *   "user.phone.label", "user.phone.hint", "user.phone.placeholder"
   *
   * Consumers may prepend a scope prefix (e.g. "auth.signup") or override keys
   * in their own UI/tooling layer. DTOs must not guess usage context.
   */
  promptKey?: string;

  /** Optional capture hint; advisory only (e.g., "email", "tel", "text"). */
  input?: string;
};

export type FieldOptsBase = {
  /**
   * required defaults to true unless explicitly set.
   * Prefer { required: false } over wrappers in v1.
   */
  required?: boolean;

  /**
   * presentByDefault defaults to true.
   * Intended for test-data "happy" generation shaping.
   */
  presentByDefault?: boolean;

  /** Tooling hint: mutate value in tests to avoid DB duplicates. */
  unique?: boolean;

  /** Optional UI metadata (canonical prompt identity + input hint). */
  ui?: FieldUiMeta;
};

export type StringFieldOpts = FieldOptsBase & {
  minLen?: number;
  maxLen?: number;

  /** Letters-only for v1 means A–Z and a–z only (no ASCII A-z shortcuts). */
  alpha?: boolean;

  /** Applies only when alpha=true for v1. */
  case?: "lower" | "upper" | "capitalized";
};

export type NumberFieldOpts = FieldOptsBase & {
  min?: number;
  max?: number;
};

export type BooleanFieldOpts = FieldOptsBase;

export type LiteralFieldOpts = FieldOptsBase;

export type EnumFieldOpts = FieldOptsBase;

export type ArrayFieldOpts = FieldOptsBase;

export type ObjectFieldOpts = FieldOptsBase;

export type UnionFieldOpts = FieldOptsBase;

export type FieldDescriptor =
  | ({
      kind: "string";
    } & StringFieldOpts)
  | ({
      kind: "number";
    } & NumberFieldOpts)
  | ({
      kind: "boolean";
    } & BooleanFieldOpts)
  | ({
      kind: "literal";
      value: string | number | boolean | null;
    } & LiteralFieldOpts)
  | ({
      kind: "enum";
      values: ReadonlyArray<string>;
    } & EnumFieldOpts)
  | ({
      kind: "array";
      of: FieldDescriptor;
    } & ArrayFieldOpts)
  | ({
      kind: "object";
      shape: Record<string, FieldDescriptor>;
    } & ObjectFieldOpts)
  | ({
      kind: "union";
      options: ReadonlyArray<FieldDescriptor>;
    } & UnionFieldOpts);

export type FieldsShape = Record<string, FieldDescriptor>;
