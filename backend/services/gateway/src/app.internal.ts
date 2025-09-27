/**
 * NowVibin — Backend
 * File: backend/services/gateway/src/app.internal.ts
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
 * - Protected by S2S auth; NOT exposed on public edge.
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

export function createInternalApp(): Express {
  const app: Express = express();

  // S2S-only plane
  app.use(requestIdMiddleware());
  app.use(makeHttpLogger("gateway-internal"));

  // Enforce S2S on everything internal — pass the middleware directly
  app.use(verifyS2S);

  // Mount internal surface
  app.use("/", createInternalRouter());

  // Tails
  app.use(notFoundProblemJson(["/"]));
  app.use(errorProblemJson());

  return app;
}
