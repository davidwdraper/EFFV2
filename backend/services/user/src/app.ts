// backend/services/user/src/app.ts

import express from "express";

import { coreMiddleware } from "@shared/middleware/core";
import { makeHttpLogger } from "@shared/middleware/httpLogger";
import { entryExit } from "@shared/middleware/entryExit";
import { auditBuffer } from "@shared/middleware/audit";
import {
  notFoundProblemJson,
  errorProblemJson,
} from "@shared/middleware/problemJson";
import { addTestOnlyHelpers } from "@shared/middleware/testHelpers";
import { createHealthRouter } from "@shared/health";
import { verifyS2S } from "@shared/middleware/verifyS2S";

import userRoutes from "./routes/userRoutes";
import userPublicRoutes from "./routes/userPublicRoutes";
import directoryRoutes from "./routes/directoryRoutes";

import { SERVICE_NAME } from "./bootstrap";
import { config } from "./config";

// Parity checks with Act (explicit env presence)
if (!config.mongoUri)
  throw new Error("Missing required env var: USER_MONGO_URI");
if (!config.port) throw new Error("Missing required env var: USER_PORT");

// ── Express app ──────────────────────────────────────────────────────────────
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Core middleware (shared)
app.use(coreMiddleware());
app.use(makeHttpLogger(SERVICE_NAME));
app.use(entryExit());
app.use(auditBuffer());

// Health (EXCEPTION: stays at root, not under /api)
app.use(
  createHealthRouter({
    service: SERVICE_NAME,
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// Require S2S for everything after health (SOP Addendum 2)
app.use(verifyS2S);

// --------------------------- API prefix --------------------------------------
// Everything user-facing for this service lives under /api/*
const api = express.Router();

// Canonical routes under /api/<serverName>/...
// <serverName> for User is "user"
api.use("/user", userRoutes); // auth-required CRUD
api.use("/user", userPublicRoutes); // public names endpoint (compat)
api.use("/user/directory", directoryRoutes); // friend-lookup/search API

// Mount the API router (same pattern as Act)
app.use("/api", api);

// Test helpers updated to match /api paths
addTestOnlyHelpers(app as any, ["/api/user", "/api/user/directory"]);

// 404 + error handlers (limit known prefixes to /api/* and /health)
app.use(notFoundProblemJson(["/api/user", "/api/user/directory", "/health"]));
app.use(errorProblemJson());

export default app;
