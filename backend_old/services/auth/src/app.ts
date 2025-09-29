// backend/services/auth/src/app.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *   - docs/adr/0027-entity-services-on-shared-createServiceApp.md
 *
 * Why:
 * - Internal-only assembly via shared builder:
 *   requestId → httpLogger → problemJson → trace5xx(early) →
 *   health (open) → verifyS2S → parsers → routes → 404 → error.
 */

import type express from "express";
import { createServiceApp } from "@eff/shared/src/app/createServiceApp";
import { verifyS2S as _verifyS2S } from "@eff/shared/src/middleware/verifyS2S";
import { logger } from "@eff/shared/src/utils/logger";
import authRoutes from "./routes/authRoutes";

/**
 * 🚨🚨🚨  TEMPORARY DEBUG BYPASS — REMOVE BEFORE PROD  🚨🚨🚨
 * SEARCH-REMOVE: AUTH_BYPASS_S2S_FOR_AUTH_ROUTES
 *
 * Purpose:
 *   Diagnose smoke #23 by skipping S2S verify ONLY for /api/auth/* when
 *   AUTH_BYPASS_S2S_FOR_AUTH_ROUTES=true. Everything else remains protected.
 *
 * Behavior:
 *   - INFO log on every request entering the verifier with method + url.
 *   - WARN log when a request is bypassed.
 *   - Console ERROR at startup if the bypass env is enabled (hard to miss).
 */
const AUTH_BYPASS =
  String(process.env.AUTH_BYPASS_S2S_FOR_AUTH_ROUTES || "")
    .trim()
    .toLowerCase() === "true";

if (AUTH_BYPASS) {
  // eslint-disable-next-line no-console
  console.error(
    "🚨 [TEMP] AUTH_BYPASS_S2S_FOR_AUTH_ROUTES=true — S2S verification is DISABLED for /api/auth/* (diagnosing smoke #23). REMOVE BEFORE PROD."
  );
}

/** True if this request targets /api/auth/* (defensive path check). */
function isAuthPath(req: express.Request): boolean {
  const p = (req.path || "").toLowerCase();
  const u = (req.originalUrl || "").toLowerCase();
  return (
    p === "/auth" ||
    p.startsWith("/auth/") ||
    u.includes("/api/auth/") ||
    u.endsWith("/api/auth")
  );
}

function verifyS2S(): express.RequestHandler {
  const real = _verifyS2S();
  return (req, res, next) => {
    // loud entry breadcrumb (info-level)
    logger.info(
      { method: req.method, url: req.originalUrl || req.url, path: req.path },
      "[auth.verifyS2S] entry"
    );

    if (AUTH_BYPASS && isAuthPath(req)) {
      logger.warn(
        { method: req.method, url: req.originalUrl || req.url },
        "[TEMP] S2S VERIFY BYPASSED for /api/auth/* — REMOVE BEFORE PROD"
      );
      return next();
    }
    return real(req, res, next);
  };
}

// Readiness (no DB for auth)
async function readiness() {
  return { upstreams: { ok: true } };
}

// One-liner route mounting (service exposes /api/auth/*)
function mountRoutes(api: express.Router) {
  api.use("/auth", authRoutes);
}

const app = createServiceApp({
  serviceName: "auth",
  apiPrefix: "/api",
  verifyS2S, // health stays open; /api/* require S2S (except TEMP bypass for /auth when enabled)
  readiness,
  mountRoutes,
});

export default app;
