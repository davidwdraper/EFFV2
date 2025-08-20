// backend/services/gateway/src/middleware/authGate.ts
import type { RequestHandler } from "express";
import axios, { AxiosError } from "axios";

/**
 * Auth strategy:
 * - GET = public by default, unless path matches PUBLIC_GET_REQUIRE_AUTH_PREFIXES.
 * - Non-GET = require Bearer token, EXCEPT auth public prefixes (login/create/reset/verify).
 * - Read-only mode blocks mutations EXCEPT read-only exempt prefixes (e.g., auth login).
 *
 * ENV (pipe-delimited prefixes):
 *   PUBLIC_GET_REQUIRE_AUTH_PREFIXES=/users/private|/users/email
 *   AUTH_PUBLIC_PREFIXES=/auth/login|/auth/create|/auth/password_reset|/auth/verify
 *   READ_ONLY_MODE=true|false
 *   READ_ONLY_EXEMPT_PREFIXES=/auth/login|/auth/verify
 *   AUTH_VERIFY_TIMEOUT_MS=1200
 *   AUTH_SERVICE_URL=<required at runtime when a protected request is present>
 */
export function authGate(): RequestHandler {
  const readOnlyMode = String(process.env.READ_ONLY_MODE || "false") === "true";

  const toList = (v?: string) =>
    String(v || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);

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

  const startsWithAny = (path: string, prefixes: string[]) =>
    prefixes.some((p) => p && path.toLowerCase().startsWith(p.toLowerCase()));

  return async (req, res, next) => {
    const method = (req.method || "GET").toUpperCase();
    const path = req.path || "/";

    // Read-only: block mutations except explicit exemptions (login/verify etc.)
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

    // GETs are public unless explicitly protected by prefix
    const isProtectedGet =
      method === "GET" && startsWithAny(path, protectedGetPrefixes);

    // Non-GETs require auth unless the path is an auth-public endpoint (login/create/reset/verify)
    const isAuthPublic = startsWithAny(path, authPublicPrefixes);
    const needsAuth =
      method !== "GET" && method !== "HEAD" ? !isAuthPublic : isProtectedGet;

    if (!needsAuth) return next();

    // Require Bearer token
    const authz = req.headers.authorization || "";
    const token = authz.startsWith("Bearer ")
      ? authz.slice("Bearer ".length)
      : "";
    if (!token) {
      return res.status(401).json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Missing Bearer token",
        instance: (req as any).id,
      });
    }

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
        (req as any).user = verify.data.user || verify.data;
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
