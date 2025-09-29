// backend/services/log/src/app.ts
/**
 * NowVibin — Backend
 * Service: log
 * -----------------------------------------------------------------------------
 * WHY:
 * - Use shared app builder so health mounts before auth, S2S is global,
 *   and versioned routes stay one-liners. This minimizes service-specific
 *   boilerplate and avoids drift across workers.
 *
 * NOTES:
 * - We keep a tiny readiness probe that depends only on Mongo connectivity;
 *   it’s cheap and deterministic. DB connect runs before route wiring so
 *   readiness reflects reality instead of “maybe soon.”
 */

import mongoose from "mongoose";
import { createServiceApp } from "@eff/shared/src/app/createServiceApp";
import { verifyS2S as sharedVerifyS2S } from "@eff/shared/src/middleware/verifyS2S";
import { logger } from "@eff/shared/src/utils/logger";
import { connectDB } from "./db";
import { mountRoutes } from "./routes/logRoutes";

// WHY: Readiness should be trivial and non-blocking; we don’t probe deep I/O here.
async function readiness() {
  const ready = mongoose.connection.readyState === 1; // 1 = connected
  return { ok: ready, upstreams: { mongo: ready } };
}

// WHY: Connect DB early so route-level work doesn’t mask a latent DB failure.
//      Boot remains resilient; bootstrap decides crash/retry policy.
void connectDB().catch((err) => {
  logger.error({ err }, "DB connect failed");
});

// WHY: Temporary bypass knob is useful for isolating middleware issues without code edits.
//      Leave it off in normal operation.
const verifyS2S =
  process.env.S2S_BYPASS === "1"
    ? (_req: any, _res: any, next: any) => next()
    : sharedVerifyS2S;

const app = createServiceApp({
  // WHY: Your shared CreateServiceAppOptions requires explicit serviceName.
  serviceName: "log",

  // WHY: Keep API namespace predictable → yields /api/log/v1/...
  apiPrefix: "/api",

  // WHY: Health routes are mounted public by the builder; S2S guards everything else.
  verifyS2S,

  readiness,

  // WHY: Single function that mounts versioned routes keeps routes one-liners and testable.
  mountRoutes,
});

export default app;
