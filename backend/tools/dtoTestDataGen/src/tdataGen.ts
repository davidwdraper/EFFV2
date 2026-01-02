// backend/tools/dtoTestDataGen/src/tdataGen.ts
/**
 * Docs:
 * - SOP: Keep generator logic tight; deterministic; no meta envelope in JSON output.
 * - ADRs:
 *   - ADR-0088
 *   - ADR-0091
 *   - ADR-0092
 *
 * Purpose:
 * - Core deterministic happy-json + hints generation from a runtime Fields object.
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

function shouldIncludeInHappy(fd: FieldDescriptor): boolean {
  if (requiredDefaultsTrue(fd)) return true;
  return presentByDefaultDefaultsTrue(fd);
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

/**
 * Unique-field exemplars:
 * - For unique:true fields, getJson() emits a "shape exemplar" string.
 * - Registry derives the shape via shapeFromHappyString(happyValue),
 *   then passes that shape into uniqueValueBuilder(shape).
 *
 * IMPORTANT:
 * - Use letters/digits in the exemplar (NOT literal '#') so shapeFromHappyString()
 *   can derive '#'-wildcards from real digits.
 *
 * v1 scope:
 * - Strings only (email/phone special-cased; everything else is a generic string exemplar).
 */
function makeUniqueExemplar(fieldName: string, fd: FieldDescriptor): string {
  const nameLower = fieldName.toLowerCase();

  // Email unique exemplar: visually a shape, still a valid-looking email.
  // Using only letters (x) ensures shapeFromHappyString() yields the same "xxxx+xxxx@xxx.xxx" pattern.
  if (nameLower.includes("email")) {
    const exemplar = "xxxx+xxxx@xxx.xxx";
    return clampLen(exemplar, fd.minLen, fd.maxLen);
  }

  // Phone unique exemplar: must use digits so shapeFromHappyString() yields '#'.
  // Keep it string-only and validator-agnostic for now (digits-only is usually safest).
  if (nameLower.includes("phone")) {
    const minLen = typeof fd.minLen === "number" ? fd.minLen : 11;
    const maxLen = typeof fd.maxLen === "number" ? fd.maxLen : minLen;

    // Prefer a stable 11-digit shape unless constrained otherwise.
    const targetLen = Math.max(1, Math.min(Math.max(minLen, 11), maxLen));
    return clampLen(digitChars(targetLen), fd.minLen, fd.maxLen);
  }

  // Generic unique strings:
  // - If alpha-only (names can be unique), keep letters-only and respect case.
  if (fd.alpha) {
    const baseLen = Math.max(fd.minLen ?? 6, 6);
    return clampLen(
      applyCaseAlpha(alphaLetters(baseLen), fd.case),
      fd.minLen,
      fd.maxLen
    );
  }

  // Otherwise, emit a readable shape exemplar using letters + hyphens.
  // Hyphen is preserved as a literal in shapeFromHappyString() and uniqueValueBuilder().
  const exemplar = "xxxx-xxxx-xxxx";
  return clampLen(exemplar, fd.minLen, fd.maxLen);
}

function makeHappyString(fieldName: string, fd: FieldDescriptor): string {
  // If the field is unique, emit a shape exemplar (not a meaningful literal).
  if (fd.unique) {
    return makeUniqueExemplar(fieldName, fd);
  }

  const nameLower = fieldName.toLowerCase();
  if (nameLower.includes("email")) {
    const local =
      `test+${fieldName.replace(/[^a-zA-Z0-9]+/g, "")}`.slice(0, 40) || "test";
    return clampLen(`${local}@nv.test`, fd.minLen, fd.maxLen);
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
  if (typeof fd.min === "number" && Number.isFinite(fd.min)) return fd.min;
  if (typeof fd.max === "number" && Number.isFinite(fd.max)) return fd.max;
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
      const shape = fd.shape ?? {};
      const o: AnyRecord = {};
      for (const [k, inner] of Object.entries(shape)) {
        if (!shouldIncludeInHappy(inner)) continue;
        o[k] = makeHappyValue(k, inner);
      }
      return o;
    }
    case "union": {
      const options = fd.options ?? [];
      if (!options.length) return null;
      return makeHappyValue(fieldName, options[0] as FieldDescriptor);
    }
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

    if (fd.kind === "string") {
      if (typeof fd.minLen === "number") hint.minLen = fd.minLen;
      if (typeof fd.maxLen === "number") hint.maxLen = fd.maxLen;
      if (fd.alpha) hint.alpha = true;
      if (fd.case) hint.case = fd.case;
    }

    if (fd.kind === "number") {
      if (typeof fd.min === "number") hint.min = fd.min;
      if (typeof fd.max === "number") hint.max = fd.max;
    }

    if (uiHints && fd.ui) {
      hint.ui = { promptKey: fd.ui.promptKey, input: fd.ui.input };
    }

    (out.fields as AnyRecord)[fieldName] = hint;
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
    const keys = Object.keys(obj);
    if (!keys.length) continue;
    const first = obj[keys[0]];
    if (
      first &&
      typeof first === "object" &&
      typeof (first as any).kind === "string"
    ) {
      return { exportName: k, fields: obj as Record<string, FieldDescriptor> };
    }
  }
  return null;
}

export function pickDtoClassExport(
  exportsObj: AnyRecord
): { exportName: string; dtoClass: any } | null {
  for (const [k, v] of Object.entries(exportsObj)) {
    if (!k.endsWith("Dto")) continue;
    if (typeof v !== "function") continue;
    if (typeof (v as any).fromBody === "function") {
      return { exportName: k, dtoClass: v };
    }
  }
  return null;
}

export function classNameForSidecar(
  dtoAbs: string,
  dtoClassExportName?: string
): string {
  if (dtoClassExportName && dtoClassExportName.endsWith("Dto")) {
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

export function renderSidecarTs(opts: {
  dtoRelFromCwd: string;
  dtoAbs: string;
  tdataClassName: string;
  happyJson: AnyRecord;
  hints: AnyRecord;
}): string {
  const happyJsonText = JSON.stringify(opts.happyJson, null, 2);
  const hintsText = JSON.stringify(opts.hints, null, 2);
  const tdataPath = sidecarPathForDto(opts.dtoAbs).split(path.sep).join("/");

  return `// ${tdataPath}
/**
 * Docs:
 * - SOP: Deterministic test fixtures; sidecar is happy-only; variants minted downstream.
 * - ADRs:
 *   - ADR-0088 (DTO Test Data Sidecars)
 *   - ADR-0091 (DTO Sidecar Tooling + Testdata Output)
 *   - ADR-0092 (DTO Fields DSL + Testdata Generation)
 *
 * Source DTO:
 * - ${opts.dtoRelFromCwd}
 *
 * Invariants:
 * - getJson() returns DATA ONLY (canonical DTO JSON). No meta envelope.
 * - getHints() returns minimal mutation hints for test tooling (uniquify/missing/etc).
 * - Generated file. Edit DTO Fields DSL, then re-generate.
 */

export class ${opts.tdataClassName} {
  public static getJson(): unknown {
    return ${happyJsonText};
  }

  public static getHints(): unknown {
    return ${hintsText};
  }
}
`;
}
