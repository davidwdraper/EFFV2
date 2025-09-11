// backend/services/act/src/app.ts
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

import actRoutes from "./routes/actRoutes";
import townRoutes from "./routes/townRoutes";

// Env enforcement (same as before)
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}
const SERVICE_NAME = requireEnv("ACT_SERVICE_NAME");
requireEnv("ACT_MONGO_URI");
requireEnv("ACT_PORT");

// Express app
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Core middleware (shared)
app.use(coreMiddleware());
app.use(makeHttpLogger(SERVICE_NAME));
app.use(entryExit());
app.use(auditBuffer());

// Health
app.use(
  createHealthRouter({
    service: SERVICE_NAME,
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// Test helpers
addTestOnlyHelpers(app as any, ["/acts", "/towns"]);

// Routes
app.use("/acts", actRoutes);
app.use("/towns", townRoutes);

// 404 + error handlers
app.use(notFoundProblemJson(["/acts", "/towns", "/health"]));
app.use(errorProblemJson());

export default app;
