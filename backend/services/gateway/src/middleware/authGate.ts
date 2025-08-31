// backend/services/gateway/src/middleware/authGate.ts
import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";

/**
 * Client Auth Gate (inbound) — single, canonical env set. No fallbacks.
 *
 * Required env (no defaults):
 *   CLIENT_AUTH_REQUIRE            ("true" | "false")
 *   CLIENT_AUTH_BYPASS             ("true" | "false")
 *   CLIENT_AUTH_JWKS_URL           (may be empty if bypassing)
 *   CLIENT_AUTH_ISSUERS            (pipe- or comma-separated)
 *   CLIENT_AUTH_AUDIENCE
 *   CLIENT_AUTH_CLOCK_SKEW_SEC
 *   CLIENT_AUTH_PUBLIC_PREFIXES
 *   CLIENT_AUTH_PROTECTED_GET_PREFIXES
 *   READ_ONLY_MODE                 ("true" | "false")
 *   READ_ONLY_EXEMPT_PREFIXES
 *
 * Notes:
 * - HS256 for client tokens is intentionally disabled to avoid confusion with S2S.
 * - Misconfiguration returns 503 (never 500).
 * - Client mistakes return 401/403.
 */

function toList(v?: string) {
  // accepts | or , separators
  return String(v || "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function startsWithAny(path: string, prefixes: string[]) {
  const p = (path || "/").toLowerCase();
  return prefixes.some((x) => x && p.startsWith(x.toLowerCase()));
}

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

// ESM under CJS — dynamic import for jose + JWKS
let _jose: any | null = null;
async function getJose() {
  if (_jose) return _jose;
  _jose = await import("jose");
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

export function authGate(): RequestHandler {
  // ── required env (no fallbacks) ────────────────────────────────────────────
  const readOnlyMode =
    String(process.env.READ_ONLY_MODE ?? "").toLowerCase() === "true";
  const authRequire =
    String(process.env.CLIENT_AUTH_REQUIRE ?? "").toLowerCase() === "true";
  const authBypass =
    String(process.env.CLIENT_AUTH_BYPASS ?? "").toLowerCase() === "true";

  const protectedGetPrefixes = toList(
    process.env.CLIENT_AUTH_PROTECTED_GET_PREFIXES
  );
  const authPublicPrefixes = toList(process.env.CLIENT_AUTH_PUBLIC_PREFIXES);
  const readOnlyExempt = toList(process.env.READ_ONLY_EXEMPT_PREFIXES);

  const jwksUrl = String(process.env.CLIENT_AUTH_JWKS_URL ?? "");
  const issuers = toList(process.env.CLIENT_AUTH_ISSUERS);
  const audience = String(process.env.CLIENT_AUTH_AUDIENCE ?? "");
  const clockSkew = Number(process.env.CLIENT_AUTH_CLOCK_SKEW_SEC ?? NaN);

  // input validation — fail closed but cleanly (503 for misconfig)
  const envInvalid =
    ![true, false].includes(readOnlyMode) || // always boolean; sanity check redundant but harmless
    Number.isNaN(clockSkew);

  // JWKS required if auth required and not bypassing
  const authMisconfigured =
    authRequire &&
    !authBypass &&
    (!jwksUrl || issuers.length === 0 || !audience);

  let getJWKS: JWKSGetter | null = null;
  if (jwksUrl) {
    try {
      new URL(jwksUrl); // early validation
      getJWKS = createJWKSGetter(jwksUrl);
    } catch {
      getJWKS = null;
    }
  }

  return async (req, res, next) => {
    if (envInvalid) {
      return res.status(503).json({
        type: "about:blank",
        title: "Auth Misconfigured",
        status: 503,
        detail: "Invalid CLIENT_AUTH_* configuration.",
        instance: (req as any).id,
      });
    }

    const method = (req.method || "GET").toUpperCase();
    const path = req.path || "/";

    // read-only: block mutations unless exempt
    if (
      readOnlyMode &&
      method !== "GET" &&
      method !== "HEAD" &&
      !startsWithAny(path, readOnlyExempt)
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

    // does this route need auth?
    const isProtectedGet =
      method === "GET" && startsWithAny(path, protectedGetPrefixes);
    const isAuthPublic = startsWithAny(path, authPublicPrefixes);
    const needsAuth = authRequire
      ? method !== "GET" && method !== "HEAD"
        ? !isAuthPublic
        : isProtectedGet
      : false;

    if (!needsAuth) return next();

    if (authBypass) {
      (req as any).user = { id: "bypass", roles: ["dev"], scopes: ["*"] };
      return next();
    }

    if (authMisconfigured || !getJWKS) {
      return res.status(503).json({
        type: "about:blank",
        title: "Auth Misconfigured",
        status: 503,
        detail:
          "CLIENT_AUTH_JWKS_URL/ISSUERS/AUDIENCE required when CLIENT_AUTH_REQUIRE=true and CLIENT_AUTH_BYPASS=false.",
        instance: (req as any).id,
      });
    }

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

    try {
      const jose = await getJose();
      const jwks = await getJWKS();
      const verified = await jose.jwtVerify(token, jwks, {
        issuer: issuers,
        audience,
        clockTolerance: clockSkew,
      });
      const payload: any = verified?.payload || {};

      (req as any).user = {
        id: (payload?.uid as string) || (payload?.sub as string) || "unknown",
        roles: (payload?.roles as string[]) || [],
        scopes:
          (payload?.scopes as string[]) ||
          (typeof payload?.scope === "string"
            ? payload.scope.split(" ").filter(Boolean)
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
