// PATH: backend/services/shared/src/utils/s2s/apiVersion.ts

/**
 * APR-0029 — Canonical API version header & helpers
 * --------------------------------------------------------------------------
 * Why:
 * - Single source of truth for API version header name and parsing logic.
 * - Keeps gateway and services aligned; no magic strings scattered around.
 *
 * Contract:
 * - Edge requires versioned slugs: "/api/:slug.vN/...".
 * - We forward the parsed version via "X-NV-Api-Version" to all upstreams.
 */

export const HEADER_API_VERSION = "x-nv-api-version";

/**
 * Parse a versioned slug segment like "act.v2" into { slug: "act", version: "v2" }.
 * - Strict, no fallbacks, no guessing.
 * - slug: lowercase; version: normalized "vN".
 */
export function parseSlugWithVersion(slugWithVer: string): {
  slug: string;
  version: string;
} {
  const m = /^([a-z0-9-]+)\.v([1-9][0-9]*)$/i.exec(
    String(slugWithVer || "").trim()
  );
  if (!m) {
    throw new Error(
      `invalid slug version segment "${slugWithVer}" (expected like "act.v1")`
    );
  }
  return { slug: m[1].toLowerCase(), version: `v${m[2].toLowerCase()}` };
}
