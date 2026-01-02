// backend/services/shared/src/testing/envVarOverride.ts
/**
 * Docs:
 * - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *
 * Purpose:
 * - Thin wrapper around overrideWithTTL specifically for EnvServiceDto vars.
 * - Keeps EnvServiceDto clean; all test-only override mechanics live here.
 */

import type { EnvServiceDto } from "../dto/env-service.dto";
import { overrideWithTTL } from "./overrideWithTTL";

/**
 * Temporarily override a non-DB env var on an EnvServiceDto.
 *
 * Usage contract:
 * - Uses envDto.getEnvVar(key) to read the current value.
 * - Mutates the underlying vars bag via a test-only setter.
 * - Returns restore() which MUST be called in a finally block.
 * - ttlMs is a safety net only; manual restore is the primary path.
 */
export function overrideEnvVarWithTTL(
  envDto: EnvServiceDto,
  key: string,
  makeTemp: (original: string) => string,
  ttlMs = 2000
): () => void {
  // Real value as seen by rails
  const original = envDto.getEnvVar(key);

  // How to write back into the live vars bag.
  // We deliberately use `any` here to avoid polluting EnvServiceDto's public surface.
  const set = (v: string) => {
    (envDto as any)._vars[key] = v;
  };

  const temp = makeTemp(original);

  // Apply override + TTL-backed restore, and get our manual restore function.
  return overrideWithTTL(set, original, temp, ttlMs);
}
