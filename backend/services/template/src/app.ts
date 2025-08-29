// backend/services/template/src/app.ts
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

import entityRoutes from "./routes/entity.routes";
import { SERVICE_NAME, config } from "./config";

if (!config.mongoUri)
  throw new Error("Missing required env var: TEMPLATE_MONGO_URI");
if (!config.port) throw new Error("Missing required env var: TEMPLATE_PORT");

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Shared middleware
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

// Test helpers (adjust roots for your service)
addTestOnlyHelpers(app as any, ["/entity"]);

// Routes
app.use("/entity", entityRoutes);

// 404 + error handlers
app.use(notFoundProblemJson(["/entity", "/health"]));
app.use(errorProblemJson());

export default app;
