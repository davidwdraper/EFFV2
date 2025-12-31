// backend/services/shared/src/dto/dsl/field.ts
/**
 * Docs:
 * - SOP: DTO-first; meta is advisory and must not mutate canonical JSON.
 * - ADRs:
 *   - ADR-0089 (DTO Field DSL with Meta Envelope)
 *   - ADR-0090 (DTO Field DSL Design + Non-Breaking Integration)
 *
 * Purpose:
 * - v1 Field factory helpers for DTO Field DSL.
 * - Returns plain objects; tooling can interpret without executing closures.
 */

import type {
  ArrayFieldOpts,
  BooleanFieldOpts,
  EnumFieldOpts,
  FieldDescriptor,
  LiteralFieldOpts,
  NumberFieldOpts,
  ObjectFieldOpts,
  StringFieldOpts,
  UnionFieldOpts,
} from "./types";

function withDefaults<
  T extends { required?: boolean; presentByDefault?: boolean }
>(opts?: T): T & { required: boolean; presentByDefault: boolean } {
  const o = (opts ?? {}) as T;
  return {
    ...o,
    required: o.required !== undefined ? o.required : true,
    presentByDefault:
      o.presentByDefault !== undefined ? o.presentByDefault : true,
  };
}

export const field = {
  string(opts?: StringFieldOpts): FieldDescriptor {
    return {
      kind: "string",
      ...withDefaults(opts),
    };
  },

  number(opts?: NumberFieldOpts): FieldDescriptor {
    return {
      kind: "number",
      ...withDefaults(opts),
    };
  },

  boolean(opts?: BooleanFieldOpts): FieldDescriptor {
    return {
      kind: "boolean",
      ...withDefaults(opts),
    };
  },

  literal(
    value: string | number | boolean | null,
    opts?: LiteralFieldOpts
  ): FieldDescriptor {
    return {
      kind: "literal",
      value,
      ...withDefaults(opts),
    };
  },

  enum(values: ReadonlyArray<string>, opts?: EnumFieldOpts): FieldDescriptor {
    return {
      kind: "enum",
      values: Array.isArray(values) ? values.slice() : Array.from(values),
      ...withDefaults(opts),
    };
  },

  array(of: FieldDescriptor, opts?: ArrayFieldOpts): FieldDescriptor {
    return {
      kind: "array",
      of,
      ...withDefaults(opts),
    };
  },

  object(
    shape: Record<string, FieldDescriptor>,
    opts?: ObjectFieldOpts
  ): FieldDescriptor {
    return {
      kind: "object",
      shape,
      ...withDefaults(opts),
    };
  },

  union(
    options: ReadonlyArray<FieldDescriptor>,
    opts?: UnionFieldOpts
  ): FieldDescriptor {
    return {
      kind: "union",
      options: Array.isArray(options) ? options.slice() : Array.from(options),
      ...withDefaults(opts),
    };
  },

  /**
   * Optional wrapper helper.
   * In v1, prefer { required:false } unless union/nullable pushes you here.
   */
  optional(inner: FieldDescriptor): FieldDescriptor {
    return {
      ...(inner as any),
      required: false,
    } as FieldDescriptor;
  },
} as const;
