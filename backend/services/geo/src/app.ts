// backend/services/geo/src/app.ts
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
import geoRoutes from "./routes/geo.routes";
import { SERVICE_NAME, config } from "./config";

if (!config.port) throw new Error("Missing required env var: GEO_PORT");

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// shared middleware
app.use(coreMiddleware());
app.use(makeHttpLogger(SERVICE_NAME));
app.use(entryExit());
app.use(auditBuffer());

// health
app.use(
  createHealthRouter({
    service: SERVICE_NAME,
    readiness: async () => ({ upstreams: { google: true } }),
  })
);

// test helpers
addTestOnlyHelpers(app as any, ["/geo"]);

// routes
app.use("/geo", geoRoutes);

// 404 + error
app.use(notFoundProblemJson(["/geo", "/health"]));
app.use(errorProblemJson());

export default app;
