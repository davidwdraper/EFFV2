// backend/services/shared/src/contracts/base.contract.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Common base for all contract classes.
 * - Provides minimal, reusable validation/normalization helpers.
 * - Keep this generic (no service-specific logic).
 */

export abstract class BaseContract<TJson extends object> {
  /** Subclasses must return a plain JSON-ready representation. */
  public abstract toJSON(): TJson;

  // ── Protected helpers for subclasses ───────────────────────────────────────

  /**
   * Ensure the input is a plain object (not null/array/function), or throw.
   * Returns it typed as a dictionary for safe field extraction.
   */
  protected static ensurePlainObject(
    input: unknown,
    ctx = "payload"
  ): Record<string, unknown> {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new Error(`${ctx}: expected plain object`);
    }
    return input as Record<string, unknown>;
  }

  /**
   * Get a string field from an object; optionally require non-empty.
   * Trims by default; can force lowercasing when useful in subclasses.
   */
  protected static takeString(
    obj: Record<string, unknown>,
    field: string,
    opts: { required?: boolean; trim?: boolean; lower?: boolean } = {
      required: true,
      trim: true,
      lower: false,
    }
  ): string | undefined {
    const raw = obj[field];
    if (raw == null) {
      if (opts.required) {
        throw new Error(`${field}: required`);
      }
      return undefined;
    }
    if (typeof raw !== "string") {
      throw new Error(`${field}: expected string`);
    }
    let s = raw;
    if (opts.trim !== false) s = s.trim();
    if (opts.lower) s = s.toLowerCase();
    if (opts.required && s.length === 0) {
      throw new Error(`${field}: must not be empty`);
    }
    return s;
  }

  /** Basic string pattern enforcement (subclasses provide the regex & field). */
  protected static requirePattern(
    value: string,
    re: RegExp,
    field = "value",
    message = "invalid format"
  ): void {
    if (!re.test(value)) {
      throw new Error(`${field}: ${message}`);
    }
  }
}
