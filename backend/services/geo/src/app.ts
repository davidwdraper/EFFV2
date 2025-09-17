// backend/services/geo/src/app.ts

/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0003-shared-app-builder.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Use the shared app builder for consistent assembly:
 *   requestId → httpLogger → problemJson → trace5xx(early) →
 *   health (open) → verifyS2S (everything else) → parsers → routes → 404 → error.
 * - No back-compat mounts; canonical paths only.
 *
 * Notes:
 * - Routes are one-liners; no logic in routes.
 * - Health is mounted by the app builder; readiness is provided below.
 */

import type express from "express";
import { createServiceApp } from "@eff/shared/src/app/createServiceApp";
import { verifyS2S } from "@eff/shared/src/middleware/verifyS2S";

import geoRoutes from "./routes/geo.routes";
import { SERVICE_NAME } from "./config";

// Readiness (geo has no DB; report simple upstream check hooks if added later)
async function readiness() {
  return { upstreams: {} };
}

// One-liner route mounting under the API router
function mountRoutes(api: express.Router) {
  // Canonical: service exposes /api/... (gateway strips /api/<slug>/)
  api.use("/", geoRoutes); // → POST /api/resolve
}

const app = createServiceApp({
  serviceName: SERVICE_NAME,
  apiPrefix: "/api",
  verifyS2S, // protect everything except health
  readiness,
  mountRoutes,
});

export default app;
