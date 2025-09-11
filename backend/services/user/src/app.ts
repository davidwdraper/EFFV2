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
import { createHealthRouter } from "@shared/src/health";

import { verifyS2S } from "@shared/middleware/verifyS2S";
import { verifyUserAssertion } from "./middleware/verifyUserAssertion";

import userRoutes from "./routes/userRoutes";
import userPublicRoutes from "./routes/userPublicRoutes";
import directoryRoutes from "./routes/directoryRoutes";

import { SERVICE_NAME } from "./config";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Core middleware
app.use(coreMiddleware());
app.use(makeHttpLogger(SERVICE_NAME));
app.use(entryExit());
app.use(auditBuffer());

// Health (kept at root)
app.use(
  createHealthRouter({
    service: SERVICE_NAME,
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// --------------------------- API prefix --------------------------------------
const api = express.Router();

// All API calls must come from an internal caller (gateway/core) with S2S
api.use(verifyS2S);

// End-user assertion only on mutating methods; gated by env
const enforceUA =
  String(process.env.USER_ASSERTION_ENFORCE || "false").toLowerCase() ===
  "true";
const uaMw = verifyUserAssertion({ enforce: enforceUA });
api.use((req, res, next) => {
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  return uaMw(req, res, next);
});

// ✅ CRUD mounted at plural path
api.use("/users", userRoutes);

// Keep public/compat endpoints (still behind S2S plane)
api.use("/user", userPublicRoutes);
api.use("/user/directory", directoryRoutes);

// Mount API router
app.use("/api", api);

// Test helpers updated to match mounts
addTestOnlyHelpers(app as any, [
  "/api/users",
  "/api/user",
  "/api/user/directory",
]);

// 404 + error handlers
app.use(
  notFoundProblemJson([
    "/api/users",
    "/api/user",
    "/api/user/directory",
    "/health",
  ])
);
app.use(errorProblemJson());

export default app;
