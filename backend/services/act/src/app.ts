// backend/services/act/src/app.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *   - docs/adr/0027-entity-services-on-shared-createServiceApp.md
 *
 * Why:
 * - Entity services are internal-only behind the gateway plane. Assemble via the
 *   shared builder: requestId → httpLogger → problemJson → trace5xx(early) →
 *   health (open) → verifyS2S → parsers → routes → 404 → error.
 */

import mongoose from "mongoose";
import type express from "express";
import { createServiceApp } from "@eff/shared/src/app/createServiceApp";
import { verifyS2S } from "@eff/shared/src/middleware/verifyS2S";
import { addTestOnlyHelpers } from "@eff/shared/src/middleware/testHelpers";

import actRoutes from "./routes/actRoutes";
import townRoutes from "./routes/townRoutes";
import { SERVICE_NAME, config } from "./config";

// Sanity: required envs (other than service name, which is from code)
if (!config.mongoUri)
  throw new Error("Missing required env var: ACT_MONGO_URI");
if (!config.port) throw new Error("Missing required env var: ACT_PORT");

// Readiness: check Mongo connection
async function readiness() {
  const state = mongoose.connection?.readyState; // 1 = connected
  return { mongo: state === 1 ? "ok" : `state=${state}` };
}

// Mount routes (one-liners only)
function mountRoutes(api: express.Router) {
  api.use("/acts", actRoutes);
  api.use("/towns", townRoutes);
}

const app = createServiceApp({
  serviceName: SERVICE_NAME,
  apiPrefix: "/api",
  verifyS2S, // internal-only: health is open; everything else requires S2S
  readiness,
  mountRoutes,
});

// Test helpers aligned to /api paths
addTestOnlyHelpers(app as any, ["/api/acts", "/api/towns"]);

export default app;
