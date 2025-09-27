/**
 * NowVibin — Backend
 * File: backend/services/gateway/src/app.ts
 *
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
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Why:
 * - Keep the gateway thin and deterministic:
 *   httpsOnly → cors → requestId → http logger → trace5xx(early) →
 *   health → guardrails → audit (WAL) → **versioned forwarding** → 404/error.
 * - Public edge app (no internal discovery/JWKS on this listener).
 */

import express, { type Express } from "express";
import { createHealthRouter } from "@eff/shared/src/health";
import { requestIdMiddleware } from "@eff/shared/src/middleware/requestId";
import { makeHttpLogger } from "@eff/shared/src/middleware/httpLogger";
import {
  notFoundProblemJson,
  errorProblemJson,
} from "@eff/shared/src/middleware/problemJson";

// Internal routers/middleware (public API surface)
import api from "./routes/api";

export default function createApp(): Express {
  const app: Express = express();

  // ── Transport & telemetry (edge-safe) ──────────────────────────────────────
  app.use(requestIdMiddleware());
  app.use(makeHttpLogger("gateway"));

  // ── Health (public) ────────────────────────────────────────────────────────
  app.use(
    createHealthRouter({
      service: "gateway",
      // readiness hook can surface svcconfig/JWKS state if desired
    })
  );

  // ── API surface (PUBLIC) ───────────────────────────────────────────────────
  app.use("/api", api);

  // ── Tails: 404 + error formatter ───────────────────────────────────────────
  app.use(
    notFoundProblemJson([
      "/api",
      "/health",
      "/healthz",
      "/readyz",
      "/live",
      "/ready",
    ])
  );
  app.use(errorProblemJson());

  return app;
}
