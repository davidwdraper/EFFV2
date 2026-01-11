// backend/services/shared/src/dto/validators/StringValidators.ts
/**
 * Docs:
 * - ADR-0079 (DtoBase.check — single normalization/validation gate)
 *
 * Purpose:
 * - Shared string validators for DTO fields.
 *
 * Notes:
 * - Validators are factories: they capture `path` and return a closure.
 * - Required-vs-optional is enforced by CheckKind ("string" vs "stringOpt");
 *   these validators assume `undefined` means "not present" and do not
 *   validate undefined.
 */

import { DtoValidationError, type Validator } from "../DtoBase";

export class StringValidators {
  /**
   * Require a non-empty string (after trim).
   */
  public static nonEmpty(path: string): Validator<string> {
    return (value: string | undefined) => {
      if (value === undefined) return; // optional semantics handled by CheckKind
      const trimmed = value.trim();
      if (!trimmed) {
        throw new DtoValidationError(`Invalid string value at "${path}"`, [
          {
            path,
            code: "string_non_empty",
            message: "Value must be a non-empty string.",
          },
        ]);
      }
    };
  }

  /**
   * Require that the string be one of the allowed values.
   */
  public static oneOf(
    path: string,
    allowed: readonly string[]
  ): Validator<string> {
    const set = new Set(allowed);
    return (value: string | undefined) => {
      if (value === undefined) return;
      if (!set.has(value)) {
        throw new DtoValidationError(`Invalid value at "${path}"`, [
          {
            path,
            code: "string_one_of",
            message: `Value must be one of: ${allowed.join(", ")}`,
          },
        ]);
      }
    };
  }

  /**
   * Enforce minimum/maximum length (after trim).
   */
  public static lengthRange(
    path: string,
    opts: { min?: number; max?: number }
  ): Validator<string> {
    const { min, max } = opts;
    return (value: string | undefined) => {
      if (value === undefined) return;
      const trimmed = value.trim();
      const len = trimmed.length;

      if (min !== undefined && len < min) {
        throw new DtoValidationError(`String too short at "${path}"`, [
          {
            path,
            code: "string_min_length",
            message: `Length must be at least ${min} characters.`,
          },
        ]);
      }

      if (max !== undefined && len > max) {
        throw new DtoValidationError(`String too long at "${path}"`, [
          {
            path,
            code: "string_max_length",
            message: `Length must be at most ${max} characters.`,
          },
        ]);
      }
    };
  }
}
