// backend/services/gateway/src/middleware/authGate.ts
import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";

/**
 * Gateway Auth Gate — LOCAL verification (no per-request network to Auth)
 *
 * RS256 via JWKS (preferred) using dynamic import('jose') so it works under CJS.
 * HS256 via AUTH_JWT_SECRET allowed in dev/test.
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

/** Extract token from common headers/cookies. */
function extractToken(req: Request): string | undefined {
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

// ──────────────────────────────────────────────────────────────────────────────
// Dynamic jose loader (ESM under CJS) + JWKS cache
let _jose: any | null = null;
async function getJose() {
  if (_jose) return _jose;
  _jose = await import("jose"); // ESM dynamic import works in CJS
  return _jose;
}

type JWKSGetter = ReturnType<typeof createJWKSGetter>;
function createJWKSGetter(jwksUrl: string) {
  let jwks: any | null = null;
  return async () => {
    if (jwks) return jwks;
    const jose = await getJose();
    jwks = jose.createRemoteJWKSet(new URL(jwksUrl), {
      cooldownDuration: 30_000,
    });
    return jwks;
  };
}

// ──────────────────────────────────────────────────────────────────────────────

export function authGate(): RequestHandler {
  const readOnlyMode = String(process.env.READ_ONLY_MODE || "false") === "true";
  const authRequire =
    String(process.env.AUTH_REQUIRE ?? "true").toLowerCase() === "true";
  const authBypass =
    (process.env.AUTH_BYPASS === "true" || process.env.AUTH_BYPASS === "1") &&
    process.env.NODE_ENV !== "production";

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

  const jwksUrl = process.env.AUTH_JWKS_URL || "";
  const issuers = toList(process.env.AUTH_ISSUERS);
  const audience = process.env.AUTH_AUDIENCE || undefined;
  const clockToleranceSec = Number(process.env.AUTH_CLOCK_SKEW_SEC || 60);

  const hsSecret = process.env.AUTH_JWT_SECRET || "";
  const isProd = process.env.NODE_ENV === "production";

  let getJWKS: JWKSGetter | null = null;
  if (jwksUrl) {
    try {
      // don’t await here; create a getter that lazy-loads jose + JWKS on first use
      getJWKS = createJWKSGetter(jwksUrl);
    } catch {
      getJWKS = null;
    }
  }

  return async (req, res, next) => {
    const method = (req.method || "GET").toUpperCase();
    const path = req.path || "/";

    // Read-only mode
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

    const isProtectedGet =
      method === "GET" && startsWithAny(path, protectedGetPrefixes);
    const isAuthPublic = startsWithAny(path, authPublicPrefixes);
    const needsAuth = authRequire
      ? method !== "GET" && method !== "HEAD"
        ? !isAuthPublic
        : isProtectedGet
      : false;

    if (!needsAuth) return next();

    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Missing authentication token",
        instance: (req as any).id,
      });
    }

    if (authBypass) {
      (req as any).user = { id: "bypass", roles: ["dev"], scopes: ["*"] };
      return next();
    }

    // E2E match passthrough
    const e2eMode = process.env.E2E_REQUIRE_AUTH === "1";
    const e2eBearer = process.env.E2E_BEARER;
    if (e2eMode && e2eBearer && tokensEqual(token, e2eBearer)) {
      (req as any).user = { id: "e2e-user", roles: ["tester"], scopes: ["*"] };
      return next();
    }

    // Local verification
    try {
      let payload: any = null;

      if (getJWKS) {
        const jose = await getJose();
        const jwks = await getJWKS();
        const verified = await jose.jwtVerify(token, jwks, {
          issuer: issuers.length ? issuers : undefined,
          audience,
          clockTolerance: clockToleranceSec,
        });
        payload = verified.payload;
      } else if (hsSecret && !isProd) {
        payload = jwt.verify(token, hsSecret) as any;
      } else {
        return res.status(500).json({
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          detail:
            "Auth not configured: set AUTH_JWKS_URL (preferred) or AUTH_JWT_SECRET (dev/test).",
          instance: (req as any).id,
        });
      }

      (req as any).user = {
        id: (payload?.uid as string) || (payload?.sub as string) || "unknown",
        roles: (payload?.roles as string[]) || [],
        scopes:
          (payload?.scopes as string[]) ||
          (typeof payload?.scope === "string"
            ? payload?.scope.split(" ").filter(Boolean)
            : []),
        email: payload?.email as string | undefined,
        name: payload?.name as string | undefined,
        iss: payload?.iss as string | undefined,
        aud: payload?.aud as string | string[] | undefined,
      };

      return next();
    } catch (err: any) {
      const message =
        err?.message ||
        (typeof err === "string" ? err : "Invalid or expired token");
      return res.status(401).json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: String(message),
        instance: (req as any).id,
      });
    }
  };
}
