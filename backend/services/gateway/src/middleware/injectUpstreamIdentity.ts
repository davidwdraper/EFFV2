// backend/services/gateway/src/middleware/injectUpstreamIdentity.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-s2s-and-x-nv-api-version.md
 *
 * Why:
 * - The gateway is the trust boundary. We never forward client Authorization nor
 *   caller-provided user assertions upstream.
 * - We always inject a fresh S2S token and always mint a new user assertion for
 *   each proxied request to ensure uniform, short-lived upstream identities.
 * - Also attach X-NV-Api-Version: v<version> based on resolved service (APR-0029).
 *
 * Notes:
 * - User assertion TTL defaults to 300s; S2S TTL capped by S2S_MAX_TTL_SEC (<=900).
 * - Any inbound 'x-nv-user-assertion' or legacy 'x-user-assertion' is ignored/overwritten.
 */

import type { RequestHandler } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import { mintS2S } from "@eff/shared/src/utils/s2s/mintS2S";
import { mintUserAssertion } from "@eff/shared/src/utils/s2s/mintUserAssertion";

export function injectUpstreamIdentity(): RequestHandler {
  return async (req, _res, next) => {
    try {
      // Always inject fresh S2S; never forward client auth upstream
      const ttlSec = Math.min(
        Number(process.env.S2S_MAX_TTL_SEC || 300) || 300,
        900
      );
      const s2s = mintS2S({ ttlSec, meta: { svc: "gateway" } });
      req.headers["authorization"] = `Bearer ${s2s}`;

      // Always mint a new user assertion; never pass through a caller-provided one
      const sub =
        (req as any)?.user?.id ||
        (req as any)?.user?.sub ||
        (req.headers["x-nv-user-id"] as string) ||
        "smoke-tests";

      // Overwrite any inbound assertion headers to enforce trust boundary
      req.headers["x-nv-user-assertion"] = mintUserAssertion(
        { sub },
        { ttlSec: 300 }
      );
      if ("x-user-assertion" in req.headers) {
        delete (req.headers as Record<string, unknown>)["x-user-assertion"]; // legacy, drop entirely
      }

      // Attach the resolved API version header (e.g., "v1")
      const v = (req as any)?.resolvedService?.version;
      if (typeof v === "number" && Number.isFinite(v)) {
        req.headers["x-nv-api-version"] = `v${v}`;
      }

      next();
    } catch (err) {
      logger.error({ err }, "[gateway] injectUpstreamIdentity failed");
      next(err);
    }
  };
}

export default injectUpstreamIdentity;
