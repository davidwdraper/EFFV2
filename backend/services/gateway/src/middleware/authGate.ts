// backend/services/gateway/src/middleware/authGate.ts
import type { RequestHandler } from "express";
import axios, { AxiosError } from "axios";

/**
 * Auth strategy:
 * - GET = public by default, unless path matches PUBLIC_GET_REQUIRE_AUTH_PREFIXES
 * - Non-GET = require Bearer token unless READ_ONLY_MODE is set -> 503
 * - Token verification is delegated to AUTH_SERVICE_URL /verify
 *
 * ENV (optional toggles — no hard defaults for required keys):
 *   READ_ONLY_MODE = "true" | "false" (default false)
 *   PUBLIC_GET_REQUIRE_AUTH_PREFIXES = "/users/me|/users/email|/users/private"  (pipe-delimited)
 *   AUTH_VERIFY_TIMEOUT_MS = number (default 1200)
 *
 * Required upstream at runtime for protected requests:
 *   AUTH_SERVICE_URL
 */
export function authGate(): RequestHandler {
  const readOnlyMode = String(process.env.READ_ONLY_MODE || "false") === "true";
  const prefixesRaw = String(
    process.env.PUBLIC_GET_REQUIRE_AUTH_PREFIXES || ""
  ).trim();
  const protectedGetPrefixes = prefixesRaw
    ? prefixesRaw.split("|").filter(Boolean)
    : [];
  const authUrl = process.env.AUTH_SERVICE_URL || "";
  const verifyTimeout = Number(process.env.AUTH_VERIFY_TIMEOUT_MS || 1200);

  return async (req, res, next) => {
    try {
      const method = (req.method || "GET").toUpperCase();
      const path = req.path || "/";

      // Global read-only mode blocks mutations
      if (readOnlyMode && method !== "GET" && method !== "HEAD") {
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
        method === "GET" &&
        protectedGetPrefixes.some(
          (p) => p && path.toLowerCase().startsWith(p.toLowerCase())
        );

      const needsAuth =
        method !== "GET" && method !== "HEAD" ? true : isProtectedGet;

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
          `${authUrl.replace(/\/+$/, "")}/verify`,
          {},
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: verifyTimeout,
          }
        );
        // Attach user to request if auth service returns user payload
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
    } catch (err: any) {
      return res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: err?.message || "Auth gate failed",
        instance: (req as any).id,
      });
    }
  };
}
