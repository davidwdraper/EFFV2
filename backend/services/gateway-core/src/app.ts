// backend/services/gateway-core/src/app.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *   - docs/adr/0026-gateway-core-on-createServiceApp.md
 *
 * Why:
 * - gateway-core is a strictly internal S2S relay: verify inbound S2S, mirror
 *   svcconfig, mint outbound S2S in the proxy handler, and forward. No edge guardrails.
 *
 * Assembly (shared builder):
 *   requestId → httpLogger → problemJson → trace5xx(early)
 *   → health (open, includes svcconfig readiness with grace)
 *   → verifyS2S (inbound)
 *   → parsers
 *   → routes (/api → genericProxy)
 *   → 404 → error
 */

import { createServiceApp } from "@eff/shared/src/app/createServiceApp";
import { verifyS2S } from "@eff/shared/src/middleware/verifyS2S";
import type express from "express";
import { genericProxy } from "./middleware/genericProxy";

// Shared svcconfig client (mirror from svcconfig service; ETag-aware)
import {
  startSvcconfigMirror,
  getSvcconfigReadiness,
} from "@eff/shared/src/svcconfig/client";

// ──────────────────────────────────────────────────────────────────────────────
// Boot: start svcconfig mirror on module load
void startSvcconfigMirror();

// Grace period for /health/ready (ms) to avoid flapping during warmup
const GRACE_MS = Number(process.env.SVCCONFIG_GRACE_MS || 15_000);
const START_TIME = Date.now();

// Readiness function (used by shared health router)
async function readiness() {
  const svcconfig = getSvcconfigReadiness();
  const uptimeMs = Date.now() - START_TIME;
  const ok = (svcconfig?.ok ?? false) || uptimeMs < GRACE_MS;
  return { ok, uptimeMs, graceMs: GRACE_MS, svcconfig };
}

// Mount routes (one-liners only)
function mountRoutes(api: express.Router) {
  // All gateway-core traffic is proxied under /api
  api.use("/", genericProxy());
}

const app = createServiceApp({
  serviceName: "gateway-core",
  apiPrefix: "/api",
  verifyS2S, // internal-only: require valid S2S for everything except health
  readiness, // exposes /health, /healthz, /readyz, etc. with svcconfig status
  mountRoutes,
});

export default app;
