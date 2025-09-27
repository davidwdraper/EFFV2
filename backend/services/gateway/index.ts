/**
 * NowVibin — Backend
 * File: backend/services/gateway/index.ts
 * Service Slug: gateway
 *
 * Docs:
 * - Design: docs/design/backend/gateway/app.md
 * - Architecture: docs/architecture/backend/MICROSERVICES.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Purpose:
 * - Start TWO listeners (public + internal) with **no env fallbacks**.
 * - Keep your existing config contract; only add dual-port bootstrap.
 */

import "tsconfig-paths/register";
import path from "node:path";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";
import { validateConfig } from "./src/config";

// Validate config BEFORE importing anything under ./src that might read cfg()
validateConfig();

const SERVICE_NAME = "gateway" as const;

// Shared required envs for BOTH listeners (no defaults, fail-fast).
const REQUIRED_ENVS = [
  // svcconfig / routing guardrails
  "SVCCONFIG_BASE_URL",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_POINTS",
  "TIMEOUT_GATEWAY_MS",
  "BREAKER_FAILURE_THRESHOLD",
  "BREAKER_HALFOPEN_AFTER_MS",
  "BREAKER_MIN_RTT_MS",
  // KMS / JWKS
  "KMS_PROJECT_ID",
  "KMS_LOCATION_ID",
  "KMS_KEY_RING_ID",
  "KMS_KEY_ID",
  "JWKS_CACHE_TTL_MS",
  // Infra
  "REDIS_URL",
];

// ── Public edge (:GATEWAY_PUBLIC_PORT) ───────────────────────────────────────
void bootstrapService({
  serviceName: `${SERVICE_NAME}-public`,
  serviceRootAbs: path.resolve(__dirname, "src"),
  // Import AFTER validateConfig so cfg() is initialized
  createApp: () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./src/app"); // public app factory you already have
    const factory = mod.createGatewayApp ?? mod.default ?? mod.app;
    return factory();
  },
  // Fail-fast: port must be explicitly set; no fallbacks.
  portEnv: "GATEWAY_PUBLIC_PORT",
  requiredEnv: REQUIRED_ENVS,
  // Gateway owns svcconfig mirror
  startSvcconfig: true,
});

// ── Internal control-plane (:GATEWAY_INTERNAL_PORT) ──────────────────────────
void bootstrapService({
  serviceName: `${SERVICE_NAME}-internal`,
  serviceRootAbs: path.resolve(__dirname, "src"),
  createApp: () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./src/app.internal"); // new internal app (dual-port)
    const factory = mod.createInternalApp ?? mod.default;
    return factory();
  },
  portEnv: "GATEWAY_INTERNAL_PORT",
  requiredEnv: REQUIRED_ENVS,
  startSvcconfig: true,
});
