// backend/services/svcconfig/src/app.ts
/**
 * Refactor: use shared internal app builder.
 * - Edge guardrails stay out; this is an internal S2S service.
 * - Health is mounted by the builder; readiness provided here.
 * - Routes are one-liners under /api (SOP).
 */

import type express from "express";
import svcconfigRoutes from "./routes/svcconfig.routes";
import { createServiceApp } from "@eff/shared/src/app/createServiceApp";

const SERVICE_NAME = "svcconfig";

const app = createServiceApp({
  serviceName: SERVICE_NAME,
  apiPrefix: "/api",

  // Mount only routes; no logic in routes per SOP.
  mountRoutes: (api: express.Router) => {
    api.use("/svcconfig", svcconfigRoutes);
  },

  // Health readiness (keep simple; DB readiness handled separately in startup)
  readiness: async () => ({ upstreams: { ok: true } }),
});

export default app;
