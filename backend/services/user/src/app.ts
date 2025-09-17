// backend/services/user/src/app.ts
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
 * - Match the baseline entity-service pattern used by ACT:
 *   shared createServiceApp → health (open) → verifyS2S (internal-only) →
 *   parsers (inside builder) → routes → 404/error tails.
 * - Keep end-user assertion enforcement for non-GET requests behind a single
 *   toggle (USER_ASSERTION_ENFORCE), but do it *inside* the /api mount to
 *   preserve uniform assembly and avoid edge drift.
 */

import mongoose from "mongoose";
import type express from "express";
import { createServiceApp } from "@eff/shared/src/app/createServiceApp";
import { verifyS2S } from "@eff/shared/src/middleware/verifyS2S";

import userRoutes from "./routes/userRoutes";
import userPublicRoutes from "./routes/userPublicRoutes";
import directoryRoutes from "./routes/directoryRoutes";
import { SERVICE_NAME, config } from "./config";
import { verifyUserAssertion } from "./middleware/verifyUserAssertion";

// Sanity: required envs (same strictness as ACT)
if (!config.mongoUri)
  throw new Error("Missing required env var: USER_MONGO_URI");
if (!config.port) throw new Error("Missing required env var: USER_PORT");

// Readiness: check Mongo connection
async function readiness() {
  const state = mongoose.connection?.readyState; // 1 = connected
  return { mongo: state === 1 ? "ok" : `state=${state}` };
}

// Mount routes (one-liners only; match ACT’s pattern)
function mountRoutes(api: express.Router) {
  // End-user assertion only on non-GET methods, gated by env (default: false)
  const enforceUA =
    String(process.env.USER_ASSERTION_ENFORCE || "false").toLowerCase() ===
    "true";
  if (enforceUA) {
    const uaMw = verifyUserAssertion({ enforce: true });
    api.use((req, res, next) => {
      const m = (req.method || "GET").toUpperCase();
      if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
      return uaMw(req, res, next);
    });
  }

  // CRUD mounted at plural path; compat/public kept per contract
  api.use("/users", userRoutes);
  api.use("/user", userPublicRoutes);
  api.use("/user/directory", directoryRoutes);
}

const app = createServiceApp({
  serviceName: SERVICE_NAME,
  apiPrefix: "/api",
  verifyS2S, // internal-only: health is open; everything else requires S2S
  readiness,
  mountRoutes,
});

export default app;
