// backend/services/shared/app/createServiceApp.ts

/**
 * Docs:
 * - Design: docs/design/backend/app/createServiceApp.md
 * - Architecture: docs/architecture/backend/MICROSERVICES.md
 * - ADRs:
 *   - docs/adr/0003-shared-app-builder.md
 *   - docs/adr/0010-5xx-first-assignment-tracing.md
 *   - docs/adr/0014-s2s-jwt-verification-for-internal-services.md
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0019-read-only-mode-guardrail.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *
 * Why:
 * - Internal services (incl. gateway-core) MUST NOT include edge guardrails
 *   (rateLimit, timeouts, circuitBreaker, client auth gate, public CORS/HSTS,
 *   proxy plane). Those live **only** in the public gateway per ADR-0015/0021.
 * - This builder assembles the **safe internal stack**: requestId → http logger →
 *   problem+json negotiator → trace5xx(early) → health → (optional) verifyS2S →
 *   (optional) readOnlyGate → json/urlencoded parsers → routes → 404 → error handler.
 *
 * Notes:
 * - No proxy, no rate limiting, no timeouts/circuit breakers, no client auth gate here.
 * - Body parsers are mounted **before** routes for services (since there is no proxy plane).
 * - Health endpoints stay open; verifyS2S runs after health.
 */

import express, { type Express, type RequestHandler } from "express";
import { requestIdMiddleware } from "../middleware/requestId";
import { makeHttpLogger } from "../middleware/httpLogger";
import {
  notFoundProblemJson,
  errorProblemJson,
} from "../middleware/problemJson";
import { trace5xx } from "../middleware/trace5xx";
import { createHealthRouter, type ReadinessFn } from "../health";
import {
  readOnlyGate,
  type ReadOnlyGateOptions,
} from "../middleware/readOnlyGate";

export type CreateServiceAppOptions = {
  /** Service slug (e.g., "gateway-core", "user"). Used in logs & trace tags. */
  serviceName: string;
  /** API base path (e.g., "/api"). */
  apiPrefix: string;
  /**
   * Function that mounts the service’s routes onto the provided Router.
   * Routes must be one-liners that import handlers only (SOP).
   */
  mountRoutes: (router: express.Router) => void;
  /** Optional S2S verifier for internal calls (health stays open). */
  verifyS2S?: RequestHandler;
  /** Health readiness hook (optional). */
  readiness?: ReadinessFn;
  /** Read-only gate options (disabled by default). */
  readOnly?: ReadOnlyGateOptions & { enabled?: boolean };
};

export function createServiceApp(opts: CreateServiceAppOptions): Express {
  const {
    serviceName,
    apiPrefix,
    mountRoutes,
    verifyS2S,
    readiness,
    readOnly,
  } = opts;

  if (!apiPrefix || !apiPrefix.startsWith("/")) {
    throw new Error(
      `[createServiceApp] apiPrefix must start with "/": got "${apiPrefix}"`
    );
  }

  const app = express();
  app.disable("x-powered-by");
  // app.set("trust proxy", true); // uncomment only if this runs behind a proxy in your env

  app.use(requestIdMiddleware());
  app.use(makeHttpLogger(serviceName));
  app.use(trace5xx("early", serviceName));

  app.use(createHealthRouter({ service: serviceName, readiness }));

  if (verifyS2S) app.use(verifyS2S);
  if (readOnly?.enabled) app.use(readOnlyGate(readOnly));

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  const api = express.Router();
  mountRoutes(api);
  app.use(apiPrefix, api);

  app.use(
    notFoundProblemJson([
      apiPrefix,
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
