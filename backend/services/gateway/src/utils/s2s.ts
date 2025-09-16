// backend/services/gateway/src/utils/s2s.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *
 * Why:
 * - Provide local verifyS2S for gateway’s private endpoints.
 * - Minting is centralized in @eff/shared; this file exposes a thin wrapper for legacy callers.
 */

import jwt, { JwtPayload } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { mintS2S as sharedMintS2S } from "@eff/shared/src/utils/s2s/mintS2S";

/** Prefer importing from @eff/shared directly; kept as a thin wrapper for uniform meta. */
export function mintS2S(
  caller = "gateway",
  ttl = Number(process.env.S2S_TOKEN_TTL_SEC || 60)
) {
  return sharedMintS2S({ ttlSec: ttl, meta: { svc: caller } });
}

/**
 * Express middleware to verify inbound S2S tokens on private gateway endpoints.
 *
 * Policy:
 *  - audience: process.env.S2S_JWT_AUDIENCE (e.g., "internal-services")
 *  - allowed issuers: ["gateway"]            // gateway-core removed
 *  - allowed callers (svc claim): ["gateway"] // minted meta.svc
 */
export function verifyS2S(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing S2S token" });
      return;
    }

    const token = auth.slice("Bearer ".length).trim();
    const decoded = jwt.verify(token, process.env.S2S_JWT_SECRET!, {
      algorithms: ["HS256"],
      audience: process.env.S2S_JWT_AUDIENCE || "internal-services",
    }) as JwtPayload & { svc?: string };

    const allowedIssuers = ["gateway"];
    const allowedCallers = ["gateway"];

    if (!decoded.iss || !allowedIssuers.includes(decoded.iss)) {
      res.status(403).json({ error: "Invalid issuer" });
      return;
    }
    if (!decoded.svc || !allowedCallers.includes(decoded.svc)) {
      res.status(403).json({ error: "Invalid caller" });
      return;
    }

    next();
  } catch (_err) {
    res.status(401).json({ error: "Invalid or expired S2S token" });
  }
}
