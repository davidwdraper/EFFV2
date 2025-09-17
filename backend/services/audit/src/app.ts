// backend/services/audit/src/app.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/src/app.ts
 *
 * Why:
 *   Internal-only assembly using the shared `createServiceApp` builder:
 *   requestId → httpLogger → problem+json → trace5xx(early) → health →
 *   verifyS2S → parsers → routes → 404 → error.
 *   Health stays open; everything under /api requires S2S.
 */

import mongoose from "mongoose";
import type express from "express";
import { createServiceApp } from "@eff/shared/src/app/createServiceApp";
import { verifyS2S } from "@eff/shared/src/middleware/verifyS2S";
import auditRoutes from "./routes/auditEvent.routes";
import { config } from "./config";

// Sanity: required envs
if (!config.mongoUri)
  throw new Error("Missing required env var: AUDIT_MONGO_URI");
if (!config.port) throw new Error("Missing required env var: AUDIT_PORT");

// Readiness: check Mongo connection (1 = connected)
async function readiness() {
  const state = mongoose.connection?.readyState; // 0=disconnected,1=connected,2=connecting,3=disconnecting
  return { mongo: state === 1 ? "ok" : `state=${state}` };
}

// One-liner routes only. NOTE: auditRoutes already prefixes with '/events'.
function mountRoutes(api: express.Router) {
  api.use(auditRoutes); // yields: /api/events, /api/events/:eventId
}

const app = createServiceApp({
  serviceName: "audit", // baked into index.ts pattern across services
  apiPrefix: "/api",
  verifyS2S, // internal-only: health open; /api requires valid S2S
  readiness,
  mountRoutes,
});

export default app;
