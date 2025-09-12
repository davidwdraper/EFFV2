// backend/services/audit/src/app.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 * - Security: docs/architecture/shared/SECURITY.md
 * - ADRs:
 *   - docs/adr/0014-s2s-jwt-verification-for-internal-services.md
 *   - docs/adr/0025-audit-accepted-counts-and-internal-assembly.md
 *
 * Why:
 * - Internal-only service assembly with strict middleware order:
 *   requestId → httpLogger → problemJson → trace5xx(early) → health →
 *   verifyS2S → body parsers → routes → 404 → error.
 * - Keep behavior: WAL-first ingest; DB is connected before HTTP in index.ts.
 */

import express from "express";

import { coreMiddleware } from "@eff/shared/src/middleware/core";
import { makeHttpLogger } from "@eff/shared/src/middleware/httpLogger";
import { entryExit } from "@eff/shared/src/middleware/entryExit";
import { auditBuffer } from "@eff/shared/src/middleware/audit";
import {
  notFoundProblemJson,
  errorProblemJson,
} from "@eff/shared/src/middleware/problemJson";
import { addTestOnlyHelpers } from "@eff/shared/src/middleware/testHelpers";
import { createHealthRouter } from "@eff/shared/src/health";
import { verifyS2S } from "@eff/shared/src/middleware/verifyS2S";

import auditRoutes from "./routes/auditEvent.routes";
import { SERVICE_NAME, config } from "./config";

// Ensure required envs
if (!config.mongoUri)
  throw new Error("Missing required env var: AUDIT_MONGO_URI");
if (!config.port) throw new Error("Missing required env var: AUDIT_PORT");

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

// INTERNAL-ONLY: enforce S2S after health, before any body parsing/routes
app.use(verifyS2S as any);

// Parse after auth to avoid wasted work on rejects
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

// API prefix
app.use("/api", auditRoutes);

// Test helpers updated to match /api paths
addTestOnlyHelpers(app as any, ["/api/events"]);

// 404 + error handlers (limit known prefixes to /api/* and /health)
app.use(notFoundProblemJson(["/api", "/health", "/healthz", "/readyz"]));
app.use(errorProblemJson());

export default app;
