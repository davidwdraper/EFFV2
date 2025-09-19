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
import { verifyS2S } from "@eff/shared/src/middleware/verifyS2S";
import authRoutes from "./routes/authRoutes";

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
  verifyS2S, // health stays open; /api/* require S2S
  readiness,
  mountRoutes,
});

export default app;
