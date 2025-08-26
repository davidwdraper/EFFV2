// backend/services/user/src/app.ts

import express from "express";

// Shared middleware & helpers (DRY across services)
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

// Service routes
import userRoutes from "./routes/userRoutes";
import userPublicRoutes from "./routes/userPublicRoutes";
import directoryRoutes from "./routes/directoryRoutes"; // friend-lookup search API

// ── Env enforcement (no defaults, identical pattern across services)
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}
const SERVICE_NAME = requireEnv("USER_SERVICE_NAME");
requireEnv("USER_MONGO_URI");
requireEnv("USER_PORT");

// Express app
export const app = express(); // named export (tests & other callers)
app.disable("x-powered-by");
app.set("trust proxy", true);

// Core middleware (shared)
app.use(coreMiddleware());
app.use(makeHttpLogger(SERVICE_NAME));
app.use(entryExit());
app.use(auditBuffer());

// Health (uniform across services)
app.use(
  createHealthRouter({
    service: SERVICE_NAME,
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// Test helpers (only under NODE_ENV=test)
addTestOnlyHelpers(app as any, ["/users", "/directory"]);

// Routes (preserve existing behavior)
app.use("/users", userRoutes); // auth-required CRUD (gateway enforces)
app.use("/users", userPublicRoutes); // public names endpoint (legacy/compat)
app.use("/directory", directoryRoutes);

// 404 and error handler (Problem+JSON, SOP-standard)
app.use(notFoundProblemJson(["/users", "/directory", "/health"]));
app.use(errorProblemJson());

// keep default export too (future-proof for different import styles)
export default app;
