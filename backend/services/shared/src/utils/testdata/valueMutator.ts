// backend/services/shared/src/utils/testdata/valueMutator.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0088 (DTO Test Data Sidecars)
 *   - ADR-0091 (DTO Sidecar Tooling + Testdata Output)
 *
 * Purpose:
 * - Mutate a "happy" string into a new value that matches a mutation shape,
 *   without requiring callers to pass a seed.
 *
 * Shape grammar (v1):
 * - 'X' → uppercase letter [A-Z]
 * - 'x' → lowercase letter [a-z]
 * - '#' → digit [0-9]
 * - any other char is treated as a literal and copied through
 *
 * Behavior:
 * - Pull characters from happyValue where possible (letters for X/x, digits for #).
 * - If happyValue runs out, fill remaining slots using uniqueValueBuilder(shape)
 *   and take the corresponding character for each slot.
 */

import { uniqueValueBuilder } from "./uniqueValueBuilder";

function isUpperAlpha(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 65 && c <= 90;
}
function isLowerAlpha(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 97 && c <= 122;
}
function isDigit(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}

function collectLetters(happy: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < happy.length; i++) {
    const ch = happy[i];
    if (isUpperAlpha(ch) || isLowerAlpha(ch)) out.push(ch);
  }
  return out;
}

function collectDigits(happy: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < happy.length; i++) {
    const ch = happy[i];
    if (isDigit(ch)) out.push(ch);
  }
  return out;
}

export function valueMutator(
  happyValue: string,
  mutationShape: string
): string {
  const happy = String(happyValue ?? "");
  const shape = String(mutationShape ?? "");
  if (!shape) {
    throw new Error(
      "VALUE_MUTATOR_SHAPE_REQUIRED: valueMutator(happyValue, mutationShape) requires a non-empty mutationShape."
    );
  }

  const letters = collectLetters(happy);
  const digits = collectDigits(happy);

  let li = 0;
  let di = 0;

  // Fill source: same-shape unique value as a backstop, without caller seeds.
  const fill = uniqueValueBuilder(shape);

  let out = "";
  for (let i = 0; i < shape.length; i++) {
    const ch = shape[i];

    if (ch === "X") {
      const take = li < letters.length ? letters[li++] : fill[i];
      out += String(take ?? "A").toUpperCase();
      continue;
    }

    if (ch === "x") {
      const take = li < letters.length ? letters[li++] : fill[i];
      out += String(take ?? "a").toLowerCase();
      continue;
    }

    if (ch === "#") {
      const take = di < digits.length ? digits[di++] : fill[i];
      out += isDigit(String(take)) ? String(take) : String(fill[i] ?? "0");
      continue;
    }

    // literal passthrough
    out += ch;
  }

  return out;
}
