// backend/services/gateway/src/app.internal.ts
/**
 * NowVibin — Backend
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Purpose:
 * - Internal control-plane listener (PRIVATE): discovery, S2S JWKS, S2S proxy.
 */

import express, { type Express } from "express";
import { requestIdMiddleware } from "@eff/shared/src/middleware/requestId";
import { makeHttpLogger } from "@eff/shared/src/middleware/httpLogger";
import {
  notFoundProblemJson,
  errorProblemJson,
} from "@eff/shared/src/middleware/problemJson";
import { verifyS2S } from "@eff/shared/src/middleware/verifyS2S";
import { createInternalRouter } from "./routes/internal/router";
import jwksRouter from "./routes/internal/jwks";

export function createInternalApp(): Express {
  const app: Express = express();

  app.use(requestIdMiddleware());
  app.use(makeHttpLogger("gateway-internal"));

  // 🚨 SEARCH-REMOVE: TEMP_PUBLIC_JWKS
  // JWKS MUST BE PUBLIC (on the internal port) — mount BEFORE verifyS2S
  app.use("/.well-known/jwks.json", jwksRouter);

  // Everything else on the internal plane requires S2S
  app.use(verifyS2S());

  // Internal-only routes (svcconfig/proxy/ping)
  app.use("/", createInternalRouter());

  app.use(notFoundProblemJson(["/"]));
  app.use(errorProblemJson());

  return app;
}
