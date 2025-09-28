/**
 * Gateway Readiness Probe
 * -----------------------------------------------------------------------------
 * Docs:
 * - Design: docs/design/backend/gateway/app.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0024-extract-readiness-from-app-assembly-for-separation-of-concerns.md
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md   // readiness must reflect KMS/svcconfig health
 *
 * Why:
 * - Keep app assembly clean; readiness lives here and is injected into the health router.
 * - Probe **required upstream services**’ `/health/ready` endpoints (authoritative, unversioned)
 *   so deploy orchestration only admits the gateway when its dependencies are actually up.
 *
 * Non-negotiables:
 * - **No env fallbacks.** Required knobs must exist; crash on boot if missing.
 * - Use the shared S2S HTTP client so identity minting is uniform (no drift).
 * - Do not “assume” routes; compute from svcconfig snapshot (baseUrl + standard health path).
 */

import type { ReadinessFn } from "@eff/shared/src/health";
import { getSvcconfigSnapshot } from "@eff/shared/src/svcconfig/client";
import type { SvcConfig } from "@eff/shared/src/contracts/svcconfig.contract";
import { s2sRequest } from "@eff/shared/src/utils/s2s/httpClient";
import { requireEnv, requireNumber } from "@eff/shared/src/env";

/** WHY: strict envs — fail fast if misconfigured. */
const REQUIRED_UPSTREAMS_RAW = requireEnv("GATEWAY_READY_UPSTREAMS"); // e.g. "user,act,payments"
const READY_PROBE_TIMEOUT_MS = requireNumber("TIMEOUT_READY_PROBE_MS"); // e.g. 1500

/** WHY: normalize once; an empty list is a config error. */
const REQUIRED_UPSTREAM_SLUGS = REQUIRED_UPSTREAMS_RAW.split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (REQUIRED_UPSTREAM_SLUGS.length === 0) {
  throw new Error(
    "[gateway:readiness] GATEWAY_READY_UPSTREAMS produced an empty list"
  );
}

/**
 * Compute the direct health URL from svcconfig.
 * NOTE:
 * - Current SvcConfig does not include `exposeHealth` or `healthPath`.
 * - Health endpoints are standardized and unversioned: `${baseUrl}/health/<kind>`.
 * - If future fields are added, extend this function (don’t inline assumptions).
 */
function healthUrlFor(cfg: SvcConfig | undefined, kind: "ready" | "live") {
  if (!cfg) return null;
  if (cfg.enabled !== true) return null;

  const base = String(cfg.baseUrl || "").replace(/\/+$/, "");
  if (!base) return null;

  // Standardized, per ADR-0016: unversioned /health/<kind>
  return `${base}/health/${kind}`;
}

/**
 * Readiness contract consumed by the shared health router.
 * - Returns a map of upstreams with ok/url/status; the router will shape the final payload.
 * - We *do not* log here; operators can see details in the health payload.
 */
export const readiness: ReadinessFn = async (_req) => {
  const snap = getSvcconfigSnapshot();
  if (!snap || !snap.services) {
    // WHY: fail the readiness check clearly if svcconfig isn’t populated yet.
    return {
      upstreams: Object.fromEntries(
        REQUIRED_UPSTREAM_SLUGS.map((s) => [s, { ok: false }])
      ),
    };
  }

  const upstreams: Record<
    string,
    { ok: boolean; url?: string; status?: number }
  > = {};

  await Promise.all(
    REQUIRED_UPSTREAM_SLUGS.map(async (slug) => {
      try {
        const cfg = (snap.services as any)[slug] as SvcConfig | undefined;
        const url = healthUrlFor(cfg, "ready");
        if (!url) {
          // Missing / disabled / no baseUrl → not ready
          upstreams[slug] = { ok: false };
          return;
        }

        // Shared client ensures KMS/JWKS-backed S2S identity
        const r = await s2sRequest<any>(url, {
          method: "GET",
          timeoutMs: READY_PROBE_TIMEOUT_MS,
          headers: { "x-nv-probe": "readiness" }, // tag for upstream logs (non-functional)
        });

        upstreams[slug] = { ok: r.status === 200, url, status: r.status };
      } catch {
        // Opaque upstream failure → not ready; keep report comprehensive.
        upstreams[slug] = { ok: false };
      }
    })
  );

  return { upstreams };
};
