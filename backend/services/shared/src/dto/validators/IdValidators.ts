// backend/services/shared/src/dto/validators/IdValidators.ts
/**
 * Docs:
 * - ADR-0057 (ID Generation & Validation — UUIDv4; immutable)
 * - ADR-0079 (DtoBase.check — single normalization/validation gate)
 *
 * Purpose:
 * - Shared ID validators (UUIDv4, etc.) for DTO fields.
 */

import { DtoValidationError, type Validator } from "../DtoBase";
import { validateUUIDv4String } from "../../utils/uuid";

export class IdValidators {
  /**
   * Require a valid UUIDv4 string.
   *
   * Notes:
   * - Required-vs-optional semantics are handled by CheckKind ("string" vs "stringOpt").
   * - This validator only runs when a (possibly undefined) string value exists.
   */
  public static uuidV4(path: string): Validator<string> {
    return (value: string | undefined) => {
      if (value === undefined) return;

      try {
        // validateUUIDv4String throws on invalid input.
        validateUUIDv4String(value);
      } catch {
        throw new DtoValidationError(`Invalid UUIDv4 at "${path}"`, [
          {
            path,
            code: "id_uuid_v4",
            message: "Value must be a valid UUIDv4 string.",
          },
        ]);
      }
    };
  }
}
