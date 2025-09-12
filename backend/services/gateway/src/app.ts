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
 *
 * Why:
 * - Assembly order follows SOP: httpsOnly → cors → requestId → http logger →
 *   trace5xx(early) → health → guardrails (SECURITY logs) → audit (WAL) →
 *   identity injection → proxy → tails (404/error).
 * - Problem+JSON formatting comes from shared middleware for single source of truth.
 * - No body parsers before proxy; keep streams zero-copy.
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
import { serviceProxy } from "./middleware/serviceProxy";
import { injectUpstreamIdentity } from "./middleware/injectUpstreamIdentity";

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
  app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true }));
}

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-request-id",
      "x-correlation-id",
      "x-amzn-trace-id",
      "x-nv-user-assertion",
    ],
  })
);

// No body parsers before proxy (streaming path)

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

// Proxy plane — inject identities then stream upstream
app.use("/api", injectUpstreamIdentity());
app.use("/api", serviceProxy());

// Tail parsers (for any non-proxied routes; none by default)
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Global tails: 404 + error (RFC7807)
app.use(notFoundProblemJson(["/api", "/health", "/__"]));
app.use(errorProblemJson());

export default app;
