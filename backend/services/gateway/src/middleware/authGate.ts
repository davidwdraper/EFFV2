// backend/services/gateway/src/middleware/authGate.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • “Only gateway is public; guardrails before proxy”
 *   • “Audit-ready: instrumentation everywhere; never block on logging”
 *   • “Only shared contracts define shared shapes”
 * - This session’s design: “Security telemetry vs billing-grade audit”
 *   • Guardrails emit SECURITY logs
 *   • Only passed requests produce AuditEvent in WAL
 *
 * Why:
 * Enforce client authentication consistently, with explicit, env-driven behavior
 * and clean failure modes (503 for misconfig, 401/403 for client issues).
 * We log *security telemetry* for all deny decisions (and selective allows)
 * using `logSecurity`, so noisy or malicious traffic never pollutes the
 * billing-grade audit WAL. This keeps the audit stream clean while giving ops
 * visibility into attacks/misuse.
 */

import type { Request, RequestHandler } from "express";
import { logSecurity } from "../utils/securityLog";

// NOTE: We deliberately avoid HS256 here to prevent confusing client auth with S2S.
// JWKS/JWT verification is handled via `jose` (loaded lazily to keep cold starts fast).

/** Accepts `|` or `,` separators and trims parts. */
function toList(v?: string) {
  return String(v || "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Case-insensitive prefix match. */
function startsWithAny(path: string, prefixes: string[]) {
  const p = (path || "/").toLowerCase();
  return prefixes.some((x) => x && p.startsWith(x.toLowerCase()));
}

/** Extract a bearer token from common locations (headers/cookies). */
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

// ──────────────────────────────────────────────────────────────────────────────
// Lazy jose import + remote JWKS cache

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
    // Why: cooldown to avoid hammering IdP; jose handles kid/alg selection.
    jwks = jose.createRemoteJWKSet(new URL(jwksUrl), {
      cooldownDuration: 30_000,
    });
    return jwks;
  };
}

// ──────────────────────────────────────────────────────────────────────────────

export function authGate(): RequestHandler {
  // Required env (no silent fallbacks)
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

  // Input validation — fail closed but cleanly (503 for misconfig).
  const envInvalid = Number.isNaN(clockSkew);

  // JWKS required if auth required and not bypassing.
  const authMisconfigured =
    authRequire &&
    !authBypass &&
    (!jwksUrl || issuers.length === 0 || !audience);

  // Pre-validate JWKS URL (early error) but don’t block if bypassing.
  let getJWKS: JWKSGetter | null = null;
  if (jwksUrl) {
    try {
      new URL(jwksUrl); // validate URL format
      getJWKS = createJWKSGetter(jwksUrl);
    } catch {
      getJWKS = null;
    }
  }

  return async (req, res, next) => {
    if (envInvalid) {
      // Why: Config problem, not client’s fault; return 503 and log SECURITY.
      logSecurity(req, {
        kind: "input_validation",
        reason: "env_invalid_clock_skew",
        decision: "blocked",
        status: 503,
        route: req.path,
        method: req.method,
      });
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

    // READ-ONLY mode: block mutations unless exempt.
    if (
      readOnlyMode &&
      method !== "GET" &&
      method !== "HEAD" &&
      !startsWithAny(path, readOnlyExempt)
    ) {
      logSecurity(req, {
        kind: "forbidden",
        reason: "read_only_mode",
        decision: "blocked",
        status: 503,
        route: path,
        method,
      });
      return res.status(503).json({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        detail:
          "Read-only mode is enabled; mutations are temporarily disabled.",
        instance: (req as any).id,
      });
    }

    // Determine if this route needs auth.
    const isProtectedGet =
      method === "GET" && startsWithAny(path, protectedGetPrefixes);
    const isAuthPublic = startsWithAny(path, authPublicPrefixes);
    const needsAuth = authRequire
      ? method !== "GET" && method !== "HEAD"
        ? !isAuthPublic
        : isProtectedGet
      : false;

    if (!needsAuth) {
      // Not protected by policy; proceed (do NOT audit here; audit happens later).
      return next();
    }

    // Bypass mode for dev/local — log as ALLOWED for visibility.
    if (authBypass) {
      (req as any).user = { id: "bypass", roles: ["dev"], scopes: ["*"] };
      logSecurity(req, {
        kind: "auth_failed",
        reason: "bypass_enabled",
        decision: "allowed", // explicitly allowed by config
        status: 200,
        route: path,
        method,
      });
      return next();
    }

    // If auth is required but JWKS/issuers/audience are not valid, it’s a 503.
    if (authMisconfigured || !getJWKS) {
      logSecurity(req, {
        kind: "input_validation",
        reason: "auth_misconfigured",
        decision: "blocked",
        status: 503,
        route: path,
        method,
      });
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
      // Missing token on a protected route → 401.
      logSecurity(req, {
        kind: "auth_failed",
        reason: "missing_token",
        decision: "blocked",
        status: 401,
        route: path,
        method,
      });
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
      // Why: jose validates alg/kid and enforces issuer/audience + clock skew.
      const verified = await jose.jwtVerify(token, jwks, {
        issuer: issuers,
        audience,
        clockTolerance: clockSkew,
      });
      const payload: any = verified?.payload || {};

      // Attach a normalized user shape for downstream usage.
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

      // Success path: no security log (keep noise low). Billing audit happens later.
      return next();
    } catch (err: any) {
      const message =
        err?.message ||
        (typeof err === "string" ? err : "Invalid or expired token");
      // Invalid token → 401; log as SECURITY.
      logSecurity(req, {
        kind: "auth_failed",
        reason: "jwt_invalid",
        decision: "blocked",
        status: 401,
        route: path,
        method,
        // Never log token or claims; message is generic by design.
      });
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
