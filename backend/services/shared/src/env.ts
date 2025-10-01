// backend/shared/src/env.ts
/**
 * Minimal env helpers (fail-fast where required).
 */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v == null || String(v).trim() === "")
    throw new Error(`Missing required env var: ${name}`);
  return String(v);
}

export function requireNumber(name: string, v: string): number {
  if (!/^-?\d+$/.test(v)) throw new Error(`Invalid numeric env var: ${name}`);
  return Number(v);
}

/** Return trimmed env var or undefined. */
export function getEnv(name: string): string | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/** Restrict a value to an allowed set. */
export function requireEnum<T extends string>(
  name: string,
  v: string,
  allowed: readonly T[]
): T {
  if (!allowed.includes(v as T))
    throw new Error(`Invalid ${name}: ${v}. Allowed: ${allowed.join(", ")}`);
  return v as T;
}
