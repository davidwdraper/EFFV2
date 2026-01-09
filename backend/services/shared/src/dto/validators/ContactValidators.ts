// backend/services/shared/src/dto/validators/ContactValidators.ts
/**
 * Docs:
 * - ADR-0079 (DtoBase.check — single normalization/validation gate)
 *
 * Purpose:
 * - Shared email and phone (E.164) validators for DTO fields.
 *
 * Patterns:
 * - `emailOpt` / `phoneE164Opt`:
 *   • Typed as Validator<string | undefined>.
 *   • Treat `undefined` as "not present" and skip validation.
 *   • Pair with CheckKind "stringOpt".
 *
 * - `emailRequired` / `phoneE164Required`:
 *   • Typed as Validator<string>.
 *   • Validator signature still receives `string | undefined` by contract,
 *     and REQUIRED semantics are enforced by throwing on undefined/empty.
 *   • Pair with CheckKind "string".
 */

import { DtoValidationError, type Validator } from "../DtoBase";

export class ContactValidators {
  // ─────────────── Optional Email ───────────────

  public static emailOpt(path: string): Validator<string | undefined> {
    // Simple, pragmatic regex – not trying to fully implement RFC 5322.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return (value: string | undefined) => {
      if (value === undefined) return;

      const trimmed = value.trim();
      if (!trimmed) {
        throw new DtoValidationError(`Invalid email at "${path}"`, [
          {
            path,
            code: "contact_email_empty",
            message: "Email must not be empty.",
          },
        ]);
      }

      if (!emailRegex.test(trimmed)) {
        throw new DtoValidationError(`Invalid email at "${path}"`, [
          {
            path,
            code: "contact_email_format",
            message: "Email must be a valid email address (local@domain.tld).",
          },
        ]);
      }
    };
  }

  // ─────────────── Required Email ───────────────

  public static emailRequired(path: string): Validator<string> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return (value: string | undefined) => {
      const trimmed = (value ?? "").trim();
      if (!trimmed) {
        throw new DtoValidationError(`Invalid email at "${path}"`, [
          {
            path,
            code: "contact_email_empty",
            message: "Email must not be empty.",
          },
        ]);
      }

      if (!emailRegex.test(trimmed)) {
        throw new DtoValidationError(`Invalid email at "${path}"`, [
          {
            path,
            code: "contact_email_format",
            message: "Email must be a valid email address (local@domain.tld).",
          },
        ]);
      }
    };
  }

  // ─────────────── Optional Phone (E.164) ───────────────

  public static phoneE164Opt(path: string): Validator<string | undefined> {
    const e164Regex = /^\+[1-9]\d{7,14}$/;

    return (value: string | undefined) => {
      if (value === undefined) return;

      const trimmed = value.trim();
      if (!trimmed) {
        throw new DtoValidationError(`Invalid phone at "${path}"`, [
          {
            path,
            code: "contact_phone_empty",
            message: "Phone number must not be empty.",
          },
        ]);
      }

      if (!e164Regex.test(trimmed)) {
        throw new DtoValidationError(`Invalid phone at "${path}"`, [
          {
            path,
            code: "contact_phone_e164",
            message:
              "Phone number must be a valid E.164 number (e.g. +15551234567).",
          },
        ]);
      }
    };
  }

  // ─────────────── Required Phone (E.164) ───────────────

  public static phoneE164Required(path: string): Validator<string> {
    const e164Regex = /^\+[1-9]\d{7,14}$/;

    return (value: string | undefined) => {
      const trimmed = (value ?? "").trim();
      if (!trimmed) {
        throw new DtoValidationError(`Invalid phone at "${path}"`, [
          {
            path,
            code: "contact_phone_empty",
            message: "Phone number must not be empty.",
          },
        ]);
      }

      if (!e164Regex.test(trimmed)) {
        throw new DtoValidationError(`Invalid phone at "${path}"`, [
          {
            path,
            code: "contact_phone_e164",
            message:
              "Phone number must be a valid E.164 number (e.g. +15551234567).",
          },
        ]);
      }
    };
  }
}
