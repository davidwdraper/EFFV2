// backend/services/gateway/src/middleware/authGate.ts
import type { Request, RequestHandler } from "express";
import axios, { AxiosError } from "axios";
import jwt from "jsonwebtoken";

/**
 * Auth strategy:
 * - GET = public by default, unless path matches PUBLIC_GET_REQUIRE_AUTH_PREFIXES.
 * - Non-GET = require token, EXCEPT auth public prefixes (login/create/reset/verify).
 * - Read-only mode blocks mutations EXCEPT read-only exempt prefixes.
 *
 * ENV (pipe-delimited prefixes):
 *   PUBLIC_GET_REQUIRE_AUTH_PREFIXES=/users/private|/users/email
 *   AUTH_PUBLIC_PREFIXES=/auth/login|/auth/create|/auth/password_reset|/auth/verify
 *   READ_ONLY_MODE=true|false
 *   READ_ONLY_EXEMPT_PREFIXES=/auth/login|/auth/verify
 *   AUTH_VERIFY_TIMEOUT_MS=1200
 *   AUTH_SERVICE_URL=<required at runtime when a protected request is present>
 *
 * E2E toggles:
 *   E2E_REQUIRE_AUTH=1     -> enable E2E fast-path checks
 *   E2E_BEARER=<token>     -> exact token match accepted in E2E mode
 *   JWT_SECRET=<secret>    -> optional: local jwt.verify() allowed in E2E mode
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

  const authUrl = (process.env.AUTH_SERVICE_URL || "").replace(/\/+$/, "");
  const verifyTimeout = Number(process.env.AUTH_VERIFY_TIMEOUT_MS || 1200);

  const e2eMode = process.env.E2E_REQUIRE_AUTH === "1";
  const e2eBearer = process.env.E2E_BEARER;
  const jwtSecret = process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET;

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

    // Require token
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

    // --- E2E fast-paths (do NOT change public routes/contracts) ---
    if (e2eMode) {
      // 1) Exact match with E2E_BEARER
      if (e2eBearer && tokensEqual(token, e2eBearer)) {
        (req as any).user = {
          id: "e2e-user",
          roles: ["tester"],
          scopes: ["*"],
        };
        return next();
      }

      // 2) Optional local JWT verification if JWT_SECRET is provided
      if (jwtSecret) {
        try {
          const payload = jwt.verify(token, jwtSecret) as any;
          (req as any).user = {
            id: payload?.uid || payload?.sub || "unknown",
            roles: payload?.roles || [],
            scopes: payload?.scopes || payload?.scope || [],
            email: payload?.email,
            name: payload?.name,
          };
          return next();
        } catch {
          // fall through to auth service /verify
        }
      }
    }

    // --- Default behavior: verify with Auth Service ---
    if (!authUrl) {
      return res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "AUTH_SERVICE_URL is not configured",
        instance: (req as any).id,
      });
    }

    try {
      const verify = await axios.post(
        `${authUrl}/verify`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: verifyTimeout,
        }
      );
      if (verify?.data) {
        (req as any).user = (verify.data as any).user || verify.data;
      }
      return next();
    } catch (e) {
      const ax = e as AxiosError;
      const status = ax.response?.status || 401;
      const message =
        (ax.response?.data as any)?.detail ||
        (ax as any)?.message ||
        "Invalid or expired token";
      return res.status(status).json({
        type: "about:blank",
        title: status === 403 ? "Forbidden" : "Unauthorized",
        status,
        detail: String(message),
        instance: (req as any).id,
      });
    }
  };
}
