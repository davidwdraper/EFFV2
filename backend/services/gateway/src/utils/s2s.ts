// backend/services/gateway/src/utils/s2s.ts
import jwt, { JwtPayload } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

/**
 * Mint an outbound S2S token for calls to internal services.
 */
export function mintS2S(
  caller = "gateway",
  ttl = Number(process.env.S2S_TOKEN_TTL_SEC || 60)
) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: "s2s",
      iss: process.env.S2S_JWT_ISSUER || "gateway",
      aud: process.env.S2S_JWT_AUDIENCE || "internal-services",
      iat: now,
      exp: now + ttl,
      svc: caller,
    },
    process.env.S2S_JWT_SECRET!,
    { algorithm: "HS256", noTimestamp: true }
  );
}

/**
 * Express middleware to verify inbound S2S tokens.
 * Protects private internal endpoints.
 *
 * Policy:
 *  - audience: "internal-services"
 *  - allowed issuers: ["gateway-core", "gateway"]
 *  - allowed callers (svc claim): ["gateway-core"]
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

    const allowedIssuers = ["gateway-core", "gateway"];
    const allowedCallers = ["gateway-core"];

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
    return;
  }
}
