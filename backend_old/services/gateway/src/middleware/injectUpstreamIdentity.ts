/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-s2s-and-x-nv-api-version.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Why:
 * - Gateway is the trust boundary. Never forward client Authorization nor inbound user assertions.
 * - Always inject a fresh S2S token and a short-lived user assertion per proxied request.
 * - Stamp X-NV-Api-Version for upstream telemetry.
 *
 * Notes:
 * - mintS2S({ ttlSec }) → Promise<string>
 * - mintUserAssertion({ sub, iss, aud, iat, exp, nv? }) → Promise<string>
 */

import type { RequestHandler } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import { mintS2S } from "@eff/shared/src/utils/s2s/mintS2S";
import { mintUserAssertion } from "@eff/shared/src/utils/s2s/mintUserAssertion";

export function injectUpstreamIdentity(): RequestHandler {
  return async (req, _res, next) => {
    try {
      // ── Strip any inbound client/user auth at the edge ─────────────────────
      const hdrs = req.headers as Record<string, unknown>;
      delete hdrs["authorization"];
      delete hdrs["x-user-assertion"]; // legacy
      delete hdrs["x-nv-user-assertion"]; // enforce trust boundary

      // ── Inject fresh S2S (new API returns Promise<string>) ─────────────────
      const s2sTtl = Math.min(
        Number(process.env.S2S_MAX_TTL_SEC || 300) || 300,
        900
      );
      const s2sToken = await mintS2S({ ttlSec: s2sTtl });
      (req.headers as Record<string, string>)[
        "authorization"
      ] = `Bearer ${s2sToken}`;

      // ── Inject short-lived user assertion (requires iat/exp + iss/aud) ─────
      const sub =
        (req as any)?.user?.id ||
        (req as any)?.user?.sub ||
        (req.headers["x-nv-user-id"] as string) ||
        "smoke-tests";

      const nowSec = Math.floor(Date.now() / 1000);
      const userTtl = Number(process.env.USER_ASSERT_TTL_SEC || 300) || 300;

      const iss =
        (process.env.USER_ASSERT_ISSUER &&
          process.env.USER_ASSERT_ISSUER.trim()) ||
        (process.env.S2S_JWT_ISSUER && process.env.S2S_JWT_ISSUER.trim()) ||
        "gateway";

      const aud =
        (process.env.USER_ASSERT_AUDIENCE &&
          process.env.USER_ASSERT_AUDIENCE.trim()) ||
        (process.env.S2S_JWT_AUDIENCE && process.env.S2S_JWT_AUDIENCE.trim()) ||
        "internal-services";

      const userAssertion = await mintUserAssertion({
        sub: String(sub),
        iss,
        aud,
        iat: nowSec,
        exp: nowSec + userTtl,
        nv: { via: "gateway" }, // optional namespaced claims
      });

      (req.headers as Record<string, string>)["x-nv-user-assertion"] =
        userAssertion;

      // ── Stamp API version header for upstreams (telemetry only) ────────────
      const verRaw =
        (req as any)?.parsedApiRoute?.version ??
        (req as any)?.resolvedService?.version;
      if (typeof verRaw === "string" && verRaw.length) {
        const m = verRaw.trim().match(/^v?(\d+)$/i);
        (req.headers as Record<string, string>)["x-nv-api-version"] = m
          ? `v${m[1]}`
          : verRaw.toLowerCase();
      } else if (typeof verRaw === "number" && Number.isFinite(verRaw)) {
        (req.headers as Record<string, string>)[
          "x-nv-api-version"
        ] = `v${verRaw}`;
      }

      next();
    } catch (err) {
      logger.error({ err }, "[gateway] injectUpstreamIdentity failed");
      next(err);
    }
  };
}

export default injectUpstreamIdentity;
