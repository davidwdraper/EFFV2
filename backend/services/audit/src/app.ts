// backend/services/audit/src/app.ts
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
import { createHealthRouter } from "@shared/src/health";

import auditRoutes from "./routes/auditEvent.routes";
import { SERVICE_NAME, config } from "./config";

// Ensure required envs (other than service name, which is from code)
if (!config.mongoUri) {
  throw new Error("Missing required env var: AUDIT_MONGO_URI");
}
if (!config.port) {
  throw new Error("Missing required env var: AUDIT_PORT");
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
// Tip: when you wire a real readiness check, plug it into `readiness`.
app.use(
  createHealthRouter({
    service: SERVICE_NAME,
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// --------------------------- API prefix --------------------------------------
// Convention: service exposes resources under /api/*
// Gateway adds the slug externally: /api/audit/<resource…>
app.use("/api", auditRoutes);

// Test helpers updated to match /api paths
addTestOnlyHelpers(app as any, ["/api/events"]);

// 404 + error handlers (limit known prefixes to /api/* and /health)
app.use(notFoundProblemJson(["/api", "/health"]));
app.use(errorProblemJson());

export default app;
