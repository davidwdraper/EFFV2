// backend/services/shared/src/utils/normalizeApiPath.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR-0032: Route policy via svcconfig
 *
 * Normalize an incoming API request path.
 *
 * Input: raw HTTP method + path (e.g. GET /api/auth/v1/users/123/)
 * Output:
 *   {
 *     slug: string | null,
 *     version: number | null,
 *     normPath: string | null,   // starts with /v<major>/...
 *     method: string             // always UPPERCASE
 *   }
 *
 * Notes:
 * - Collapses duplicate slashes.
 * - Strips trailing slash except when path is exactly "/".
 */
export function normalizeApiPath(
  method: string,
  rawPath: string
): {
  slug: string | null;
  version: number | null;
  normPath: string | null;
  method: string;
} {
  try {
    const cleaned = rawPath.replace(/\/{2,}/g, "/");
    const parts = cleaned.split("/").filter(Boolean);
    if (parts.length < 3 || parts[0] !== "api") {
      return {
        slug: null,
        version: null,
        normPath: null,
        method: method.toUpperCase(),
      };
    }
    const slug = parts[1];
    const vMatch = /^v(\d+)$/.exec(parts[2]);
    if (!vMatch) {
      return {
        slug: null,
        version: null,
        normPath: null,
        method: method.toUpperCase(),
      };
    }
    const version = Number(vMatch[1]);
    const remainder = "/" + parts.slice(2).join("/");
    const normPath =
      remainder !== "/" ? remainder.replace(/\/+$/, "") : remainder;
    return { slug, version, normPath, method: method.toUpperCase() };
  } catch {
    return {
      slug: null,
      version: null,
      normPath: null,
      method: method.toUpperCase(),
    };
  }
}
