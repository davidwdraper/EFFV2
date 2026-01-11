// backend/services/shared/src/dto/validators/NumberValidators.ts
/**
 * Docs:
 * - ADR-0079 (DtoBase.check — single normalization/validation gate)
 *
 * Purpose:
 * - Shared number validators for DTO fields.
 *
 * Notes:
 * - Required-vs-optional is enforced by CheckKind ("number" vs "numberOpt").
 * - These validators treat `undefined` as "not present" and skip validation.
 */

import { DtoValidationError, type Validator } from "../DtoBase";

export class NumberValidators {
  /**
   * Require a positive integer (> 0).
   */
  public static positiveInt(path: string): Validator<number> {
    return (value: number | undefined) => {
      if (value === undefined) return;
      if (!Number.isInteger(value) || value <= 0) {
        throw new DtoValidationError(`Invalid positive integer at "${path}"`, [
          {
            path,
            code: "number_positive_int",
            message: "Value must be a positive integer.",
          },
        ]);
      }
    };
  }

  /**
   * Require that the number be within [min, max] (inclusive).
   */
  public static range(
    path: string,
    opts: { min?: number; max?: number }
  ): Validator<number> {
    const { min, max } = opts;
    return (value: number | undefined) => {
      if (value === undefined) return;

      if (min !== undefined && value < min) {
        throw new DtoValidationError(`Number too small at "${path}"`, [
          {
            path,
            code: "number_min",
            message: `Value must be >= ${min}.`,
          },
        ]);
      }

      if (max !== undefined && value > max) {
        throw new DtoValidationError(`Number too large at "${path}"`, [
          {
            path,
            code: "number_max",
            message: `Value must be <= ${max}.`,
          },
        ]);
      }
    };
  }
}
