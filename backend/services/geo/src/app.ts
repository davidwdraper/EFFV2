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
import { createHealthRouter } from "@shared/src/health";
import { verifyS2S } from "@shared/middleware/verifyS2S";
import geoRoutes from "./routes/geo.routes";
import { SERVICE_NAME, config } from "./config";

if (!config.port) throw new Error("Missing required env var: GEO_PORT");

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// ── shared middleware
app.use(coreMiddleware());
app.use(makeHttpLogger(SERVICE_NAME));
app.use(entryExit());
app.use(auditBuffer());

// ── health (open)
app.use(
  createHealthRouter({
    service: SERVICE_NAME,
    readiness: async () => ({ upstreams: { google: true } }),
  })
);

// ── S2S protection for everything else
app.use(verifyS2S);

// ── test helpers (limit to real routes)
addTestOnlyHelpers(app as any, [
  "/resolve",
  "/api/resolve", // ← include canonical path
  "/health",
  "/healthz",
  "/readyz",
]);

// ── routes
// Canonical mount (matches gateway-core forwarding: /api/<slug>/... → /api/...)
app.use("/api", geoRoutes);

// Back-compat alias (remove once callers stop using root-mounted paths)
app.use("/", geoRoutes);

// ── 404 + error
app.use(
  notFoundProblemJson([
    "/resolve",
    "/api/resolve", // ← include canonical path
    "/health",
    "/healthz",
    "/readyz",
  ])
);
app.use(errorProblemJson());

export default app;
