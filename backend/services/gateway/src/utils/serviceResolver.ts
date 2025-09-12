// backend/services/gateway/src/utils/serviceResolver.ts

/**
 * Docs:
 * - Design: docs/design/backend/gateway/service-resolution.md
 * - Architecture: docs/architecture/backend/MICROSERVICES.md
 * - ADRs:
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *
 * Why:
 * - Keep "how we resolve upstream base URLs" in one place for the gateway.
 * - **Internal resolution** ignores `allowProxy` (workers may be private).
 * - **Public resolution** requires `allowProxy=true` for safety at the edge.
 *
 * Notes:
 * - We depend only on the live svcconfig mirror snapshot; no network calls here.
 * - `joinUrl()` is a tiny helper to avoid subtle `//` bugs when composing URLs.
 */
import { getSvcconfigSnapshot } from "@eff/shared/src/svcconfig/client";

export function resolveInternalBase(slug: string): string | null {
  const snap = getSvcconfigSnapshot();
  if (!snap) return null;
  const svc = snap.services[String(slug || "").toLowerCase()];
  if (!svc || svc.enabled !== true) return null;
  return svc.baseUrl.replace(/\/+$/, "");
}

export function resolvePublicBase(slug: string): string | null {
  const snap = getSvcconfigSnapshot();
  if (!snap) return null;
  const svc = snap.services[String(slug || "").toLowerCase()];
  if (!svc || svc.enabled !== true || svc.allowProxy !== true) return null;
  return svc.baseUrl.replace(/\/+$/, "");
}

export function joinUrl(base: string, path: string): string {
  const b = (base || "").replace(/\/+$/, "");
  const p = String(path || "");
  return p.startsWith("/") ? `${b}${p}` : `${b}/${p}`;
}
