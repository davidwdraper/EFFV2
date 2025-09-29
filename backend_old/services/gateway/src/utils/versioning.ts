// backend/services/gateway/src/utils/versioning.ts
/**
 * WHY:
 * External API version markers on the wire are "V1" or "v1" (NEVER bare "1").
 * svcconfig stores versions as the digit string "1".
 * Normalize once so service resolution is consistent.
 *
 * NOTE: Add ADR reference once you assign the number (e.g., ADR-00xx).
 */
export function normalizeApiVersion(input: string | undefined): {
  raw: string; // e.g., "V1"
  digit: string; // e.g., "1" (canonical for svcconfig)
  pretty: string; // e.g., "v1" (for logs/metrics)
} {
  const raw = (input ?? "").trim();
  const m = raw.match(/^[Vv](\d+)$/); // accept only V<digits> or v<digits>
  const num = m ? m[1] : "";
  return {
    raw,
    digit: num, // use this to match svcconfig ["1","2",...]
    pretty: num ? `v${num}` : "",
  };
}
