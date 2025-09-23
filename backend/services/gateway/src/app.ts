// backend/services/gateway/src/app.ts

/**
 * Docs:
 * - Design: docs/design/backend/gateway/app.md
 * - Architecture: docs/architecture/backend/MICROSERVICES.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0010-5xx-first-assignment-tracing.md
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0019-read-only-mode-guardrail.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0024-extract-readiness-from-app-assembly-for-separation-of-concerns.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md   // NEW
 *
 * Why:
 * - Keep the gateway thin and deterministic:
 *   httpsOnly → cors → requestId → http logger → trace5xx(early) →
 *   health → guardrails → audit (WAL) → **versioned forwarding** → 404/error.
 * - ADR-0030: publish JWKS so workers can verify ES256 tokens signed by KMS.
 * - No body parsers before forwarding; keep streams zero-copy to upstream.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createHealthRouter } from "@eff/shared/src/health";
import { logger } from "@eff/shared/src/utils/logger";

import { serviceName, rateLimitCfg, timeoutCfg, breakerCfg } from "./config";

// Shared middleware
import { requestIdMiddleware } from "@eff/shared/src/middleware/requestId";
import { makeHttpLogger as loggingMiddleware } from "@eff/shared/src/middleware/httpLogger";
import {
  notFoundProblemJson,
  errorProblemJson,
} from "@eff/shared/src/middleware/problemJson";

// Edge-only (local) middleware
import { trace5xx } from "./middleware/trace5xx";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { timeoutsMiddleware } from "./middleware/timeouts";
import { circuitBreakerMiddleware } from "./middleware/circuitBreaker";
import { authGate } from "./middleware/authGate";
import { sensitiveLimiter } from "./middleware/sensitiveLimiter";
import { httpsOnly } from "./middleware/httpsOnly";

// Versioned API router → forwards via shared callBySlug (no resolver drift)
import apiRouter from "./routes/api";

// NEW: JWKS publication for ADR-0030 (workers verify ES256 via this key)
import { createJwksRouter } from "./routes/jwks";

// Svcconfig mirror (non-blocking boot)
import { startSvcconfigMirror } from "@eff/shared/src/svcconfig/client";

// Audit WAL
import { initWalFromEnv, walSnapshot } from "./services/auditWal";
import { auditCapture } from "./middleware/auditCapture";

// Readiness (SoC)
import { readiness } from "./readiness";

// ──────────────────────────────────────────────────────────────────────────────
// Kick off svcconfig mirror (poll/redis handled in shared)
void startSvcconfigMirror();

// App
export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);

// Transport & Telemetry
app.use(httpsOnly());
if (process.env.FORCE_HTTPS === "true") {
  // WHY: enforce HSTS when running behind TLS terminator in staging/prod
  app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true }));
}

app.use(
  cors({
    // WHY: edge accepts browser clients; keep permissive CORS but restrict methods/headers
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    // APR-0029: allow X-NV-Api-Version across the edge
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-request-id",
      "x-correlation-id",
      "x-amzn-trace-id",
      "x-nv-user-assertion",
      "x-nv-api-version",
    ],
  })
);

// No body parsers before forwarding (streaming path)

// Request ID → HTTP logger → 5xx trace (early)
app.use(requestIdMiddleware());
app.use(loggingMiddleware(serviceName));
app.use(trace5xx("early"));

// Health/readiness (public; unauthenticated; not audited)
app.use(
  "/",
  createHealthRouter({
    service: serviceName,
    readiness,
  })
);

// NEW: JWKS (public). Workers fetch this to verify ES256 tokens (ADR-0030).
// WHY: mount at both well-known and simple alias.
app.use("/", createJwksRouter());

// Service health proxy (public; unauthenticated; not audited)
// Examples:
//   GET /user/health/live    → http://<user>.…/health/live
//   GET /act/health/ready    → http://<act>.…/health/ready
// Health is intentionally **unversioned**.
import { proxyServiceHealth } from "./middleware/proxyServiceHealth";
app.use("/:slug/health", proxyServiceHealth());

// WAL diagnostics (safe, non-billable)
app.get("/__audit", (_req, res) => {
  const snap = walSnapshot();
  res.json({ ok: !!snap, ...(snap || { note: "WAL not initialized yet" }) });
});

// Guardrails (SECURITY logs on denials; not WAL)
app.use(rateLimitMiddleware(rateLimitCfg));
app.use(sensitiveLimiter());
app.use(timeoutsMiddleware(timeoutCfg));
app.use(circuitBreakerMiddleware(breakerCfg));
app.use(authGate());

// Billing-grade audit (only passed requests)
initWalFromEnv(); // idempotent; starts replay
app.use(auditCapture());

// Lightweight root
app.get("/", (_req, res) => res.type("text/plain").send("gateway is up"));

/**
 * APR-0029 — Versioned API forwarding at the edge
 *   Route shape: /api/:slug.V<version>/...
 *   - apiRouter parses <slug>.V<version>, validates (via shared svcconfig snapshot),
 *     and forwards via shared callBySlug (S2S client handles identity minting).
 *
 * Order matters: guardrails → audit → /api router.
 */
app.use("/api", apiRouter);

// Tail parsers (for any non-forwarded routes; none by default)
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Global tails: 404 + error (RFC7807)
app.use(
  notFoundProblemJson(["/api", "/health", "/.well-known", "/jwks", "/__"])
);
app.use(errorProblemJson());

export default app;
