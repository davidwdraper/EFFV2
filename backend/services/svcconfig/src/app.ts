// backend/services/svcconfig/src/app.ts
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

import svcconfigRoutes from "./routes/svcservice.routes";
import { SERVICE_NAME, config } from "./config";

// Ensure required envs (other than service name, which is from code)
if (!config.mongoUri) {
  throw new Error("Missing required env var: SERVICECONFIG_MONGO_URI");
}
if (!config.port) {
  throw new Error("Missing required env var: SERVICECONFIG_PORT");
}

// Express app
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

// --------------------------- API prefix --------------------------------------
// Everything user-facing for this service lives under /api/*
const api = express.Router();

// Routes under /api
api.use("/svcconfig", svcconfigRoutes);

// Mount the API router
app.use("/api", api);

// Test helpers updated to match /api paths
addTestOnlyHelpers(app as any, ["/api/svcconfig"]);

// 404 + error handlers (limit known prefixes to /api/* and /health)
app.use(notFoundProblemJson(["/api/svcconfig", "/health"]));
app.use(errorProblemJson());

export default app;
