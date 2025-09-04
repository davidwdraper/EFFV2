// backend/shared/middleware/verifyUserAssertion.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim())
    throw new Error(`Missing required env var: ${name}`);
  return String(v).trim();
}
function toList(v?: string) {
  return String(v || "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Required for verification in workers (services)
const USER_ASSERTION_SECRET = reqEnv("USER_ASSERTION_SECRET"); // HS256 secret (NOT the S2S secret)
const USER_ASSERTION_AUDIENCE = reqEnv("USER_ASSERTION_AUDIENCE"); // e.g. "internal-users"
const USER_ASSERTION_ACCEPTED_ISSUERS = toList(
  reqEnv("USER_ASSERTION_ACCEPTED_ISSUERS")
); // e.g. "gateway,gateway-core"
const USER_ASSERTION_CLOCK_SKEW_SEC = Number(
  process.env.USER_ASSERTION_CLOCK_SKEW_SEC || 0
);

export const verifyUserAssertion: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const method = (req.method || "GET").toUpperCase();
  // Default policy: protect mutations only; GET/HEAD pass without an end-user assertion.
  if (method === "GET" || method === "HEAD") return next();

  const tok =
    (req.headers["x-nv-user-assertion"] as string | undefined) ||
    (req.headers["X-NV-USER-ASSERTION"] as unknown as string | undefined);

  if (!tok) {
    return res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "Missing X-NV-User-Assertion",
      instance: (req as any).id,
    });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = jwt.verify(tok, USER_ASSERTION_SECRET, {
      algorithms: ["HS256"],
      audience: USER_ASSERTION_AUDIENCE,
      clockTimestamp: now + USER_ASSERTION_CLOCK_SKEW_SEC,
    }) as jwt.JwtPayload;

    const iss = String(payload.iss || "");
    if (!USER_ASSERTION_ACCEPTED_ISSUERS.includes(iss)) {
      return res.status(401).json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Invalid assertion issuer",
        instance: (req as any).id,
      });
    }
    const sub = String(payload.sub || "");
    if (!sub.startsWith("user:")) {
      return res.status(401).json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Invalid assertion subject",
        instance: (req as any).id,
      });
    }

    (req as any).assertUser = {
      id: sub.slice(5),
      roles: (payload.roles as string[]) || [],
      scopes:
        (payload.scopes as string[]) ||
        (typeof payload.scope === "string"
          ? payload.scope.split(" ").filter(Boolean)
          : []),
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      iss,
      aud: payload.aud,
      jti: payload.jti,
    };

    return next();
  } catch (err: any) {
    return res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: String(err?.message || err),
      instance: (req as any).id,
    });
  }
};

export default verifyUserAssertion;
