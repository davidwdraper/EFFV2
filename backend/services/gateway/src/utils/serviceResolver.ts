// backend/services/gateway/src/utils/serviceResolver.ts
/**
 * Docs:
 * - Design: docs/design/backend/gateway/service-resolution.md
 * - Architecture: docs/architecture/backend/MICROSERVICES.md
 * - ADRs:
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/00XX-api-version-canonicalization-gateway-svcconfig.md   // TODO: set #
 *
 * Why:
 * - Keep "how we resolve upstream base URLs" in one place for the gateway.
 * - Internal resolution ignores `allowProxy` (workers may be private).
 * - Public resolution requires `allowProxy=true` for safety at the edge.
 * - Versioning normalization: external paths use V-prefixed versions (V1/v1);
 *   svcconfig stores the canonical **digit**. Your schema shows `version: 1`
 *   (number). We support both shapes:
 *     - `version: number`
 *     - or `versions: string[]` (digits as strings)
 *
 * Notes:
 * - Only depends on the live svcconfig mirror snapshot; no network calls.
 * - joinUrl() avoids `//` bugs when composing URLs.
 */
import { getSvcconfigSnapshot } from "@eff/shared/src/svcconfig/client";

// ─────────────────────────────────────────────────────────────────────────────
// Existing base URL resolvers (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
export function resolveInternalBase(slug: string): string | null {
  const snap = getSvcconfigSnapshot();
  if (!snap) return null;
  const svc = snap.services[String(slug || "").toLowerCase()];
  if (!svc || svc.enabled !== true) return null;
  return String(svc.baseUrl || "").replace(/\/+$/, "");
}

export function resolvePublicBase(slug: string): string | null {
  const snap = getSvcconfigSnapshot();
  if (!snap) return null;
  const svc = snap.services[String(slug || "").toLowerCase()];
  if (!svc || svc.enabled !== true || svc.allowProxy !== true) return null;
  return String(svc.baseUrl || "").replace(/\/+$/, "");
}

export function joinUrl(base: string, path: string): string {
  const b = (base || "").replace(/\/+$/, "");
  const p = String(path || "");
  return p.startsWith("/") ? `${b}${p}` : `${b}/${p}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW: Version canonicalization + version-aware public resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize external "V1"/"v1" to a digit string "1" for svcconfig matching.
 * Bare "1" on the wire is not accepted (contract: V<digit> or v<digit> only).
 */
export function normalizeApiVersionExternal(input: string | undefined): {
  raw: string; // e.g., "V1"
  digit: string; // e.g., "1" (canonical for config)
  pretty: string; // e.g., "v1" (for logging)
} {
  const raw = (input ?? "").trim();
  const m = raw.match(/^[Vv](\d+)$/);
  const num = m ? m[1] : "";
  return { raw, digit: num, pretty: num ? `v${num}` : "" };
}

/**
 * Return true iff the svc defines this version.
 * Supports either:
 *   - svc.version: number   (your current schema)
 *   - svc.versions: string[]  (optional future/alt schema)
 */
function svcSupportsVersionDigit(svc: any, digit: string): boolean {
  if (!digit) return false;

  // Preferred: single numeric `version`
  if (typeof svc?.version === "number") {
    return String(svc.version) === digit;
  }

  // Optional: string array `versions`
  const arr: unknown = svc?.versions;
  if (Array.isArray(arr)) {
    return (arr as unknown[]).some((v) => String(v) === digit);
  }

  // No version info means "not supported"
  return false;
}

/**
 * Public resolver with version check:
 * - Takes slug and EXTERNAL version (V1/v1).
 * - Normalizes to digit "1" for svcconfig.
 * - Requires allowProxy=true and version match.
 * - Returns baseUrl (no trailing slash) + the matched digit.
 */
export function resolvePublicBaseForVersion(
  slug: string,
  externalVersion: string
): { baseUrl: string; versionDigit: string } | null {
  if (!slug) return null;

  const norm = normalizeApiVersionExternal(externalVersion);
  if (!norm.digit) return null; // reject malformed external version

  const snap = getSvcconfigSnapshot();
  if (!snap) return null;
  const svc = snap.services[String(slug).toLowerCase()];
  if (!svc || svc.enabled !== true || svc.allowProxy !== true) return null;

  if (!svcSupportsVersionDigit(svc, norm.digit)) return null;

  return {
    baseUrl: String(svc.baseUrl || "").replace(/\/+$/, ""),
    versionDigit: norm.digit,
  };
}
