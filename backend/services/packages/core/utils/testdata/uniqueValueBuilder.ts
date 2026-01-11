// backend/services/shared/src/utils/testdata/uniqueValueBuilder.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0088 (DTO Test Data Sidecars)
 *   - ADR-0091 (DTO Sidecar Tooling + Testdata Output)
 *
 * Purpose:
 * - Mint a deterministic-ish, collision-resistant string value that matches a
 *   simple "shape" pattern, without requiring any caller-provided seed.
 *
 * Shape grammar (v1):
 * - 'X' → uppercase letter [A-Z]
 * - 'x' → lowercase letter [a-z]
 * - '#' → digit [0-9]
 * - any other char is treated as a literal and copied through (e.g., '-', '@', '.')
 *
 * Notes:
 * - A fresh GUID is generated internally (magic box). Callers do not pass seeds.
 * - Output is intended for test-time uniqueness (e.g., unique email/phone fields).
 * - No logging, no env, no fallbacks.
 */

import { createHash } from "crypto";
import { newUuid } from "../uuid";

type ShapeChar = "X" | "x" | "#";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const b = Number.parseInt(hex.slice(i, i + 2), 16);
    out.push(Number.isFinite(b) ? b : 0);
  }
  return out;
}

function pickFromAlphabet(
  bytes: number[],
  cursor: { i: number },
  alphabet: string
): string {
  if (!alphabet.length) return "";
  const idx = bytes[cursor.i % bytes.length] % alphabet.length;
  cursor.i++;
  return alphabet[idx];
}

const ALPHA_UP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALPHA_LO = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

/**
 * Build a value that matches the provided shape.
 * Example shapes:
 * - "Xxxxxxx" → "Qkzmtap"
 * - "xxxxxxx@xxx.com" → "kqmtzpa@qwe.com" (literals preserved)
 * - "###-###-####" → "839-120-5574"
 */
export function uniqueValueBuilder(shape: string): string {
  const s = String(shape ?? "");
  if (!s) {
    throw new Error(
      "UNIQUE_VALUE_SHAPE_REQUIRED: uniqueValueBuilder(shape) requires a non-empty shape string."
    );
  }

  const guid = newUuid();
  const hex = sha256Hex(`nv.testdata:${guid}:${s}`);
  const bytes = hexToBytes(hex);
  const cursor = { i: 0 };

  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as ShapeChar | string;

    if (ch === "X") {
      out += pickFromAlphabet(bytes, cursor, ALPHA_UP);
      continue;
    }
    if (ch === "x") {
      out += pickFromAlphabet(bytes, cursor, ALPHA_LO);
      continue;
    }
    if (ch === "#") {
      out += pickFromAlphabet(bytes, cursor, DIGITS);
      continue;
    }

    // literal passthrough
    out += ch;
  }

  return out;
}

/**
 * Derive a "shape" from an existing string by mapping:
 * - [A-Z] → 'X'
 * - [a-z] → 'x'
 * - [0-9] → '#'
 * - everything else → literal passthrough
 *
 * This is the bridge that lets the Registry uniquify a field
 * WITHOUT requiring shape metadata in the sidecar tool (v1).
 */
export function shapeFromHappyString(happy: string): string {
  const s = String(happy ?? "");
  if (!s) return "Xxxxxxxx"; // minimal fallback shape for empty strings (still deterministic-ish)

  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = ch.charCodeAt(0);

    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;

    if (isUpper) out += "X";
    else if (isLower) out += "x";
    else if (isDigit) out += "#";
    else out += ch; // keep punctuation, '@', '.', '-', '+', etc.
  }

  return out;
}
