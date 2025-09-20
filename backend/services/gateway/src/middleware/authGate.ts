// backend/services/gateway/src/middleware/authGate.ts
import type { Request, RequestHandler } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

/**
 * Auth strategy (unchanged semantics, local verify only):
 * - GET = public by default, unless path matches PUBLIC_GET_REQUIRE_AUTH_PREFIXES.
 * - Non-GET = require auth, EXCEPT AUTH_PUBLIC_PREFIXES (login/create/reset/verify).
 * - Read-only mode blocks mutations EXCEPT READ_ONLY_EXEMPT_PREFIXES.
 *
 * ENV (pipe-delimited prefixes):
 *   PUBLIC_GET_REQUIRE_AUTH_PREFIXES=/users/private|/users/email
 *   AUTH_PUBLIC_PREFIXES=/auth/login|/auth/create|/auth/password_reset|/auth/verify
 *   READ_ONLY_MODE=true|false
 *   READ_ONLY_EXEMPT_PREFIXES=/auth/login|/auth/verify
 *
 * Local verification (User Assertion — preferred path):
 *   USER_ASSERTION_SECRET=devlocal-users-internal
 *   USER_ASSERTION_ISSUER=gateway
 *   USER_ASSERTION_AUDIENCE=internal-users
 *   USER_ASSERTION_ALGS=HS256|HS384|HS512      (default HS256)
 *   USER_ASSERTION_CLOCK_SKEW_SEC=30           (default 30)
 *
 * Optional local verification (Client Authorization — not required for smoke #7):
 *   CLIENT_JWT_SECRET=devlocal-client-secret
 *   CLIENT_JWT_ISSUER=smoke-suite
 *   CLIENT_JWT_AUDIENCE=nv-clients
 *   CLIENT_JWT_ALGS=HS256                      (default HS256)
 *   CLIENT_JWT_CLOCK_SKEW_SEC=60               (default 60)
 *
 * E2E toggles (kept):
 *   E2E_REQUIRE_AUTH=1
 *   E2E_BEARER=<token>   // exact match accepted
 */

function toList(v?: string) {
  return String(v || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function startsWithAny(path: string, prefixes: string[]) {
  const p = path.toLowerCase();
  return prefixes.some((x) => x && p.startsWith(x.toLowerCase()));
}

/** Extract token from common headers/cookies. Accepts:
 *  - Authorization: Bearer <jwt> OR raw <jwt>
 *  - x-access-token / x-auth-token / x-authorization
 *  - Cookies: auth / token / jwt
 */
function extractAuthzToken(req: Request): string | undefined {
  const hAuth =
    (req.headers["authorization"] as string | undefined) ??
    (req.headers["Authorization"] as unknown as string | undefined);
  if (hAuth && typeof hAuth === "string") {
    const trimmed = hAuth.trim();
    if (/^bearer\s+/i.test(trimmed))
      return trimmed.replace(/^bearer\s+/i, "").trim();
    return trimmed;
  }
  const alt = ["x-access-token", "x-auth-token", "x-authorization"] as const;
  for (const name of alt) {
    const v = req.headers[name];
    if (typeof v === "string" && v) return v.trim();
  }
  const c = (req as any).cookies as Record<string, string> | undefined;
  if (c) {
    if (c.auth) return c.auth.trim();
    if (c.token) return c.token.trim();
    if (c.jwt) return c.jwt.trim();
  }
  return undefined;
}

function tokensEqual(a?: string, b?: string) {
  const raw = (x?: string) => (x ? x.replace(/^bearer\s+/i, "").trim() : "");
  return raw(a) === raw(b);
}

type Claims = JwtPayload & Record<string, unknown>;
type VerifiedUser = {
  id: string;
  roles?: string[];
  scopes?: string[] | string;
  email?: string;
  name?: string;
  [k: string]: unknown;
};

// ——— Local verifiers ———
function verifyJwt(
  token: string,
  {
    secret,
    algs,
    clockSkewSec,
    issuer,
    audience,
  }: {
    secret: string;
    algs: string[];
    clockSkewSec: number;
    issuer?: string;
    audience?: string;
  }
): Claims {
  const payload = jwt.verify(token, secret, {
    algorithms: algs as jwt.Algorithm[],
    clockTolerance: clockSkewSec,
    issuer,
    audience,
  }) as JwtPayload | string;
  if (typeof payload === "string") return { sub: "unknown", name: payload };
  return payload as Claims;
}

function verifyUserAssertionLocal(token: string): VerifiedUser {
  const secret = process.env.USER_ASSERTION_SECRET;
  if (!secret) {
    const e: any = new Error("USER_ASSERTION_SECRET not configured");
    e.code = "USER_ASSERTION_SECRET_MISSING";
    throw e;
  }
  const algs = toList(process.env.USER_ASSERTION_ALGS || "HS256");
  const clockSkew = Number(process.env.USER_ASSERTION_CLOCK_SKEW_SEC || 30);
  const issuer = process.env.USER_ASSERTION_ISSUER || undefined;
  const audience = process.env.USER_ASSERTION_AUDIENCE || undefined;

  const claims = verifyJwt(token, {
    secret,
    algs,
    clockSkewSec: clockSkew,
    issuer,
    audience,
  });

  return {
    id: (claims.sub as string) || (claims as any).uid || "unknown",
    roles: (claims as any).roles || [],
    scopes: (claims as any).scopes || (claims as any).scope || [],
    email: (claims as any).email,
    name: (claims as any).name,
    ...claims,
  };
}

function verifyClientAuthLocal(token: string): Claims {
  const secret = process.env.CLIENT_JWT_SECRET;
  if (!secret) {
    const e: any = new Error("CLIENT_JWT_SECRET not configured");
    e.code = "CLIENT_JWT_SECRET_MISSING";
    throw e;
  }
  const algs = toList(process.env.CLIENT_JWT_ALGS || "HS256");
  const clockSkew = Number(process.env.CLIENT_JWT_CLOCK_SKEW_SEC || 60);
  const issuer = process.env.CLIENT_JWT_ISSUER || undefined;
  const audience = process.env.CLIENT_JWT_AUDIENCE || undefined;
  return verifyJwt(token, {
    secret,
    algs,
    clockSkewSec: clockSkew,
    issuer,
    audience,
  });
}

export function authGate(): RequestHandler {
  const readOnlyMode = String(process.env.READ_ONLY_MODE || "false") === "true";

  const protectedGetPrefixes = toList(
    process.env.PUBLIC_GET_REQUIRE_AUTH_PREFIXES
  );
  const authPublicPrefixes = toList(
    process.env.AUTH_PUBLIC_PREFIXES ||
      "/auth/login|/auth/create|/auth/password_reset|/auth/verify"
  );
  const readOnlyExemptPrefixes = toList(
    process.env.READ_ONLY_EXEMPT_PREFIXES || "/auth/login|/auth/verify"
  );

  const e2eMode = process.env.E2E_REQUIRE_AUTH === "1";
  const e2eBearer = process.env.E2E_BEARER;

  return async (req, res, next) => {
    const method = (req.method || "GET").toUpperCase();
    const path = req.path || "/";

    // Read-only: block mutations except explicit exemptions
    if (
      readOnlyMode &&
      method !== "GET" &&
      method !== "HEAD" &&
      !startsWithAny(path, readOnlyExemptPrefixes)
    ) {
      return res.status(503).json({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        detail:
          "Read-only mode is enabled; mutations are temporarily disabled.",
        instance: (req as any).id,
      });
    }

    // Determine if this request needs auth
    const isProtectedGet =
      method === "GET" && startsWithAny(path, protectedGetPrefixes);
    const isAuthPublic = startsWithAny(path, authPublicPrefixes);
    const needsAuth =
      method !== "GET" && method !== "HEAD" ? !isAuthPublic : isProtectedGet;

    if (!needsAuth) return next();

    // Prefer the end-user assertion header (matches smoke/lib/s2s.sh)
    const userAssertion =
      (req.headers["x-nv-user-assertion"] as string | undefined) ??
      (req.headers["X-NV-User-Assertion"] as unknown as string | undefined);

    // Optional: client 'Authorization' (not required for smoke #7)
    const clientAuth = extractAuthzToken(req);

    // ---- E2E fast-paths (unchanged) ---------------------------------------
    if (e2eMode) {
      if (e2eBearer && clientAuth && tokensEqual(clientAuth, e2eBearer)) {
        (req as any).user = {
          id: "e2e-user",
          roles: ["tester"],
          scopes: ["*"],
        };
        return next();
      }
      // If E2E is on and we have a local secret for assertions, accept it
      if (userAssertion && process.env.USER_ASSERTION_SECRET) {
        try {
          (req as any).user = verifyUserAssertionLocal(userAssertion);
          return next();
        } catch {
          // fall through to normal path
        }
      }
    }

    // ---- Normal path: require a valid user assertion for mutations ---------
    if (!userAssertion) {
      return res.status(401).json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Missing user assertion (X-NV-User-Assertion).",
        instance: (req as any).id,
      });
    }

    try {
      const user = verifyUserAssertionLocal(userAssertion);
      (req as any).user = user;

      // Optionally validate client Authorization (best-effort; not required)
      if (clientAuth && process.env.CLIENT_JWT_SECRET) {
        try {
          (req as any).client = verifyClientAuthLocal(clientAuth);
        } catch {
          // Do not block if user assertion is valid; keep edge friction low.
        }
      }

      return next();
    } catch (err: any) {
      const isConfig = err?.code === "USER_ASSERTION_SECRET_MISSING";
      const status = isConfig ? 500 : 401;
      return res.status(status).json({
        type: "about:blank",
        title: status === 401 ? "Unauthorized" : "Internal Server Error",
        status,
        detail:
          status === 401
            ? "Invalid or expired user assertion."
            : "User assertion verification not configured (missing secret).",
        instance: (req as any).id,
      });
    }
  };
}
