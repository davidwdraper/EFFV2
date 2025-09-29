// backend/services/shared/src/env.ts
/**
 * Minimal env helpers
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
