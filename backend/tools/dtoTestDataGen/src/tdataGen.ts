// backend/tools/dtoTestDataGen/src/tdataGen.ts
/**
 * Docs:
 * - SOP: Keep generator logic tight; deterministic; no meta envelope in JSON output.
 * - ADRs:
 *   - ADR-0088
 *   - ADR-0091
 *   - ADR-0092
 *   - ADR-0102 (edge hydration requires _id UUIDv4)
 *
 * Purpose:
 * - Core deterministic happy-json + hints generation from a runtime Fields object.
 *
 * Generator policy (ADR-0092):
 * - Sidecar getJson() is "all-fields happy" by default.
 * - Only exclusion in v1: optional + unique fields are omitted (explicitly skipped).
 * - Setters remain canonical; nv-dto-gen --verify detects drift.
 */

import path from "node:path";

type AnyRecord = Record<string, any>;

export type FieldKind =
  | "string"
  | "number"
  | "boolean"
  | "literal"
  | "enum"
  | "array"
  | "object"
  | "union";

/**
 * Mirror the DSL’s small, closed format surface.
 * (Tool-local on purpose; generator consumes runtime plain objects.)
 */
export type StringFieldFormat =
  | "email"
  | "phoneDigits"
  | "state2"
  | "zip5"
  | "isoTime"
  | "json"
  | "uuidv4";

export type NumberFieldFormat = "lat" | "lng";

export type FieldDescriptor = {
  kind: FieldKind;

  required?: boolean;
  presentByDefault?: boolean;
  unique?: boolean;
  ui?: { promptKey?: string; input?: string };

  minLen?: number;
  maxLen?: number;
  alpha?: boolean;
  case?: "lower" | "upper" | "capitalized";

  min?: number;
  max?: number;

  /** Non-regex format hint used to mint happy-path exemplars. */
  format?: StringFieldFormat | NumberFieldFormat;

  value?: string | number | boolean | null;
  values?: ReadonlyArray<string>;

  of?: FieldDescriptor;
  shape?: Record<string, FieldDescriptor>;
  options?: ReadonlyArray<FieldDescriptor>;
};

export type BuildHintsOpts = {
  /**
   * Include UI hint metadata in output.
   * Default: false (tests do not need UI concerns by default).
   */
  uiHints?: boolean;
};

export function sidecarPathForDto(dtoAbs: string): string {
  if (!dtoAbs.endsWith(".dto.ts")) {
    throw new Error(`dto file must end with .dto.ts: ${dtoAbs}`);
  }
  return dtoAbs.replace(/\.dto\.ts$/, ".dto.tdata.ts");
}

function requiredDefaultsTrue(fd: FieldDescriptor): boolean {
  return fd.required !== undefined ? !!fd.required : true;
}

function presentByDefaultDefaultsTrue(fd: FieldDescriptor): boolean {
  return fd.presentByDefault !== undefined ? !!fd.presentByDefault : true;
}

/**
 * Sidecar JSON inclusion policy (v1):
 * - Include required fields always.
 * - Include optional fields too (all-fields tests must be meaningful),
 *   EXCEPT optional+unique fields which are explicitly skipped.
 */
function shouldIncludeInHappy(fd: FieldDescriptor): boolean {
  const required = requiredDefaultsTrue(fd);
  if (required) return true;
  if (fd.unique === true) return false;
  return true;
}

function alphaLetters(len: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[i % alphabet.length];
  return out;
}

function applyCaseAlpha(
  s: string,
  mode?: "lower" | "upper" | "capitalized"
): string {
  if (!mode) return s;
  if (mode === "lower") return s.toLowerCase();
  if (mode === "upper") return s.toUpperCase();
  if (!s.length) return s;
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

function clampLen(s: string, minLen?: number, maxLen?: number): string {
  let out = s;
  if (maxLen !== undefined && out.length > maxLen) out = out.slice(0, maxLen);
  if (minLen !== undefined && out.length < minLen)
    out += alphaLetters(minLen - out.length);
  return out;
}

function digitChars(len: number): string {
  const digits = "1234567890";
  let out = "";
  for (let i = 0; i < len; i++) out += digits[i % digits.length];
  return out;
}

function clampNumber(n: number, min?: number, max?: number): number {
  let out = n;
  if (typeof min === "number" && Number.isFinite(min) && out < min) out = min;
  if (typeof max === "number" && Number.isFinite(max) && out > max) out = max;
  return out;
}

/**
 * Unique-field exemplars:
 * - For unique:true fields, getJson() emits a "shape exemplar" string.
 * - Registry derives the shape via shapeFromHappyString(happyValue),
 *   then passes that shape into uniqueValueBuilder(shape).
 *
 * IMPORTANT:
 * - UUIDv4 is NOT shape-uniquified.
 */
function makeUniqueExemplar(fieldName: string, fd: FieldDescriptor): string {
  const fmt = fd.format;

  if (fmt === "uuidv4" || fieldName === "_id") {
    return makeFormattedString(fieldName, fd, "uuidv4");
  }

  if (fmt === "email" || fieldName.toLowerCase().includes("email")) {
    return clampLen("xxxx+xxxx@xxx.xxx", fd.minLen, fd.maxLen);
  }

  if (fmt === "phoneDigits" || fieldName.toLowerCase().includes("phone")) {
    const minLen = typeof fd.minLen === "number" ? fd.minLen : 10;
    const maxLen = typeof fd.maxLen === "number" ? fd.maxLen : minLen;
    const targetLen = Math.max(1, Math.min(Math.max(minLen, 10), maxLen));
    return clampLen(digitChars(targetLen), fd.minLen, fd.maxLen);
  }

  if (fd.alpha) {
    const baseLen = Math.max(fd.minLen ?? 6, 6);
    return clampLen(
      applyCaseAlpha(alphaLetters(baseLen), fd.case),
      fd.minLen,
      fd.maxLen
    );
  }

  return clampLen("xxxx-xxxx-xxxx", fd.minLen, fd.maxLen);
}

function makeFormattedString(
  fieldName: string,
  fd: FieldDescriptor,
  format: StringFieldFormat
): string {
  switch (format) {
    case "uuidv4":
      return clampLen(
        "3d2f1c7a-8b4e-4d3a-a2b8-3c4d5e6f7a8b",
        fd.minLen,
        fd.maxLen
      );

    case "email": {
      const local =
        `test+${fieldName.replace(/[^a-zA-Z0-9]+/g, "")}`.slice(0, 40) ||
        "test";
      return clampLen(`${local}@nv.test`, fd.minLen, fd.maxLen);
    }

    case "phoneDigits": {
      const minLen = typeof fd.minLen === "number" ? fd.minLen : 10;
      const maxLen = typeof fd.maxLen === "number" ? fd.maxLen : minLen;
      const targetLen = Math.max(1, Math.min(Math.max(minLen, 10), maxLen));
      return clampLen(digitChars(targetLen), fd.minLen, fd.maxLen);
    }

    case "state2":
      return clampLen("CA", fd.minLen ?? 2, fd.maxLen ?? 2);

    case "zip5":
      return clampLen("12345", fd.minLen ?? 5, fd.maxLen ?? 5);

    case "isoTime":
      return clampLen("2020-01-02T03:04:05.678Z", fd.minLen, fd.maxLen);

    case "json":
      return clampLen("{}", fd.minLen, fd.maxLen);

    default:
      return clampLen(`t_${fieldName}`, fd.minLen, fd.maxLen);
  }
}

function makeHappyString(fieldName: string, fd: FieldDescriptor): string {
  const fmt = fd.format;

  // Number formats never apply to string minting
  if (fmt === "lat" || fmt === "lng") {
    return clampLen(`t_${fieldName}`, fd.minLen, fd.maxLen);
  }

  if (fmt === "uuidv4" || fieldName === "_id") {
    return makeFormattedString(fieldName, fd, "uuidv4");
  }

  if (fd.unique) {
    return makeUniqueExemplar(fieldName, fd);
  }

  const sFmt = fmt as StringFieldFormat | undefined;

  if (
    sFmt === "email" ||
    sFmt === "phoneDigits" ||
    sFmt === "state2" ||
    sFmt === "zip5" ||
    sFmt === "isoTime" ||
    sFmt === "json"
  ) {
    return makeFormattedString(fieldName, fd, sFmt);
  }

  if (fd.alpha) {
    const baseLen = Math.max(fd.minLen ?? 6, 6);
    return clampLen(
      applyCaseAlpha(alphaLetters(baseLen), fd.case),
      fd.minLen,
      fd.maxLen
    );
  }

  return clampLen(`t_${fieldName}`, fd.minLen, fd.maxLen);
}

function makeHappyNumber(fd: FieldDescriptor): number {
  const fmt = fd.format;

  if (fmt === "lat") return clampNumber(37.7749, fd.min ?? -90, fd.max ?? 90);
  if (fmt === "lng")
    return clampNumber(-122.4194, fd.min ?? -180, fd.max ?? 180);

  if (typeof fd.min === "number") return fd.min;
  if (typeof fd.max === "number") return fd.max;
  return 1;
}

function makeHappyValue(fieldName: string, fd: FieldDescriptor): any {
  switch (fd.kind) {
    case "string":
      return makeHappyString(fieldName, fd);
    case "number":
      return makeHappyNumber(fd);
    case "boolean":
      return true;
    case "literal":
      return fd.value ?? null;
    case "enum":
      return Array.isArray(fd.values) && fd.values.length ? fd.values[0] : "";
    case "array":
      return [];
    case "object": {
      const o: AnyRecord = {};
      for (const [k, inner] of Object.entries(fd.shape ?? {})) {
        if (!shouldIncludeInHappy(inner)) continue;
        o[k] = makeHappyValue(k, inner);
      }
      return o;
    }
    case "union":
      return fd.options?.length
        ? makeHappyValue(fieldName, fd.options[0])
        : null;
    default:
      return null;
  }
}

export function buildHappyJson(
  fields: Record<string, FieldDescriptor>
): AnyRecord {
  const out: AnyRecord = {};
  for (const [fieldName, fd] of Object.entries(fields)) {
    if (!shouldIncludeInHappy(fd)) continue;
    out[fieldName] = makeHappyValue(fieldName, fd);
  }
  return out;
}

export function buildHints(
  fields: Record<string, FieldDescriptor>,
  opts?: BuildHintsOpts
): AnyRecord {
  const uiHints = !!opts?.uiHints;
  const out: AnyRecord = { fields: {} as AnyRecord };

  for (const [fieldName, fd] of Object.entries(fields)) {
    const hint: AnyRecord = {
      kind: fd.kind,
      required: requiredDefaultsTrue(fd),
      presentByDefault: presentByDefaultDefaultsTrue(fd),
    };

    if (fd.unique) hint.unique = true;
    if (fd.format) hint.format = fd.format;

    if (fd.kind === "string") {
      if (fd.minLen !== undefined) hint.minLen = fd.minLen;
      if (fd.maxLen !== undefined) hint.maxLen = fd.maxLen;
      if (fd.alpha) hint.alpha = true;
      if (fd.case) hint.case = fd.case;
    }

    if (fd.kind === "number") {
      if (fd.min !== undefined) hint.min = fd.min;
      if (fd.max !== undefined) hint.max = fd.max;
    }

    if (uiHints && fd.ui) {
      hint.ui = { promptKey: fd.ui.promptKey, input: fd.ui.input };
    }

    out.fields[fieldName] = hint;
  }

  return out;
}

export function pickFieldsExport(
  exportsObj: AnyRecord
): { exportName: string; fields: Record<string, FieldDescriptor> } | null {
  for (const [k, v] of Object.entries(exportsObj)) {
    if (!k.endsWith("Fields")) continue;
    if (!v || typeof v !== "object") continue;
    const obj = v as AnyRecord;
    const first = obj[Object.keys(obj)[0]];
    if (first && typeof first === "object" && typeof first.kind === "string") {
      return { exportName: k, fields: obj };
    }
  }
  return null;
}

export function pickDtoClassExport(
  exportsObj: AnyRecord
): { exportName: string; dtoClass: any } | null {
  for (const [k, v] of Object.entries(exportsObj)) {
    if (!k.endsWith("Dto")) continue;
    if (typeof v === "function" && typeof (v as any).fromBody === "function") {
      return { exportName: k, dtoClass: v };
    }
  }
  return null;
}

export function classNameForSidecar(
  dtoAbs: string,
  dtoClassExportName?: string
): string {
  if (dtoClassExportName?.endsWith("Dto")) {
    return `${dtoClassExportName}Tdata`;
  }
  const base = path.basename(dtoAbs).replace(/\.dto\.ts$/, "");
  const pascal = base
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
  return `${pascal}DtoTdata`;
}
