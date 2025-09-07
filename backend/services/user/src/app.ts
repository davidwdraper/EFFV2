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

// 🔐 Internal caller verification (gateway/gateway-core S2S)
import { verifyS2S } from "@shared/middleware/verifyS2S";

// ✅ Use the LOCAL assertion verifier (not the shared one)
import { verifyUserAssertion } from "./middleware/verifyUserAssertion";

import userRoutes from "./routes/userRoutes";
import userPublicRoutes from "./routes/userPublicRoutes";
import directoryRoutes from "./routes/directoryRoutes";

import { SERVICE_NAME } from "./config";

// ── Express app ───────────────────────────────────────────────────────────────
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(coreMiddleware());
app.use(makeHttpLogger(SERVICE_NAME));
app.use(entryExit());
app.use(auditBuffer());

// ── Health (EXCEPTION: stays at root, not under /api) ────────────────────────
app.use(
  createHealthRouter({
    service: SERVICE_NAME,
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// ── API plane ────────────────────────────────────────────────────────────────
const api = express.Router();

// All API calls must come from an internal caller (gateway/core) with S2S
api.use(verifyS2S);

// In dev we do NOT require an end-user assertion for simple CRUD smoke tests.
// If you set USER_ASSERTION_ENFORCE=true, we’ll require it for mutating methods.
const enforceUA =
  String(process.env.USER_ASSERTION_ENFORCE || "false").toLowerCase() ===
  "true";
const userAssertionMw = verifyUserAssertion({ enforce: enforceUA });

// Apply assertion only to mutating methods (PUT/PATCH/POST/DELETE)
api.use((req, res, next) => {
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  return userAssertionMw(req, res, next);
});

// Routes under /api
api.use("/user", userRoutes); // auth-required CRUD
api.use("/user", userPublicRoutes); // public names endpoint (compat, still behind S2S)
api.use("/user/directory", directoryRoutes); // friend-lookup/search API

// Mount API under /api
app.use("/api", api);

// Test helpers (match mounted prefixes)
addTestOnlyHelpers(app as any, ["/api/user", "/api/user/directory"]);

// 404 + error handlers (limit known prefixes)
app.use(notFoundProblemJson(["/api/user", "/api/user/directory", "/health"]));
app.use(errorProblemJson());

export default app;
