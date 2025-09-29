// backend/services/shared/src/utils/clean.ts

/**
 * Remove undefined (and optionally null) properties from plain objects/arrays.
 * - Non-mutating: returns a new value
 * - Recurses into arrays/objects
 * - Leaves falsy-but-valid values (0, false, "") intact
 */
export function clean<T>(value: T, { stripNull = false } = {}): T {
  if (Array.isArray(value)) {
    return value
      .map((v) => clean(v, { stripNull }))
      .filter(
        (v) => v !== undefined && (!stripNull || v !== null)
      ) as unknown as T;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      if (stripNull && v === null) continue;
      const cleaned = clean(v as any, { stripNull });
      if (cleaned !== undefined && (!stripNull || cleaned !== null)) {
        out[k] = cleaned;
      }
    }
    return out as T;
  }

  return value;
}
