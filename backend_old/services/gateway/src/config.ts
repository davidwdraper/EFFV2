/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *
 * Purpose:
 * - No import-time env assertions. Read/validate inside validateConfig().
 * - Provide safe, lazy accessors via cfg() and small selector helpers.
 *
 * Usage:
 *   import { validateConfig, cfg, rateLimitCfg, timeoutCfg, breakerCfg } from "./config";
 *   validateConfig(); // during bootstrap (before anything calls cfg())
 *   const { svcconfig } = cfg(); // later usage
 */

import { requireEnv, requireNumber, requireEnum } from "@eff/shared/src/env";

export type NodeEnv = "dev" | "docker" | "production";

export type GatewayConfig = {
  serviceName: "gateway";
  nodeEnv: NodeEnv;
  portEnv: "PORT"; // we bind to PORT inside the service
  svcconfig: {
    baseUrl: string; // SVCCONFIG_BASE_URL
    lkgPath?: string; // SVCCONFIG_LKG_PATH (optional)
  };
  timeouts: {
    gatewayMs: number; // TIMEOUT_GATEWAY_MS
  };
  rateLimit: {
    windowMs: number; // RATE_LIMIT_WINDOW_MS
    points: number; // RATE_LIMIT_POINTS
  };
  breaker: {
    failureThreshold: number; // BREAKER_FAILURE_THRESHOLD
    halfOpenAfterMs: number; // BREAKER_HALFOPEN_AFTER_MS
    minRttMs: number; // BREAKER_MIN_RTT_MS
  };
  accessRules: {
    enabled: boolean; // ACCESS_RULES_ENABLED (optional, default false)
    failOpen: boolean; // ACCESS_FAIL_OPEN (optional, default false)
  };
  redisUrl?: string; // REDIS_URL (optional)
  kms: {
    projectId: string; // KMS_PROJECT_ID
    locationId: string; // KMS_LOCATION_ID
    keyRingId: string; // KMS_KEY_RING_ID
    keyId: string; // KMS_KEY_ID
    jwksCacheTtlMs: number; // JWKS_CACHE_TTL_MS
  };
};

let CACHED: GatewayConfig | null = null;

// simple boolean parser for "1/true/yes/on"
function parseBool(name: string, def = "0"): boolean {
  const v = String(process.env[name] ?? def)
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function validateConfig(): GatewayConfig {
  // All reads happen here — not at module import.
  const nodeEnv = requireEnum("NODE_ENV", [
    "dev",
    "docker",
    "production",
  ]) as NodeEnv;

  const baseUrl = requireEnv("SVCCONFIG_BASE_URL");
  try {
    // Validate URL early for a nice error message
    // eslint-disable-next-line no-new
    new URL(baseUrl);
  } catch {
    throw new Error(`SVCCONFIG_BASE_URL must be a valid URL (got: ${baseUrl})`);
  }

  const cfg: GatewayConfig = {
    serviceName: "gateway",
    nodeEnv,
    portEnv: "PORT",

    svcconfig: {
      baseUrl,
      lkgPath: process.env.SVCCONFIG_LKG_PATH || undefined,
    },

    timeouts: {
      gatewayMs: requireNumber("TIMEOUT_GATEWAY_MS"),
    },

    rateLimit: {
      windowMs: requireNumber("RATE_LIMIT_WINDOW_MS"),
      points: requireNumber("RATE_LIMIT_POINTS"),
    },

    breaker: {
      failureThreshold: requireNumber("BREAKER_FAILURE_THRESHOLD"),
      halfOpenAfterMs: requireNumber("BREAKER_HALFOPEN_AFTER_MS"),
      minRttMs: requireNumber("BREAKER_MIN_RTT_MS"),
    },

    accessRules: {
      enabled: parseBool("ACCESS_RULES_ENABLED", "0"),
      failOpen: parseBool("ACCESS_FAIL_OPEN", "0"),
    },

    redisUrl: process.env.REDIS_URL || undefined,

    kms: {
      projectId: requireEnv("KMS_PROJECT_ID"),
      locationId: requireEnv("KMS_LOCATION_ID"),
      keyRingId: requireEnv("KMS_KEY_RING_ID"),
      keyId: requireEnv("KMS_KEY_ID"),
      jwksCacheTtlMs: requireNumber("JWKS_CACHE_TTL_MS"),
    },
  };

  CACHED = cfg;
  return cfg;
}

export function cfg(): GatewayConfig {
  if (!CACHED) {
    throw new Error("cfg() accessed before validateConfig() initialization");
  }
  return CACHED;
}

// Small selector helpers to minimize churn in existing call sites:
export const serviceName = "gateway" as const;

export function rateLimitCfg() {
  return cfg().rateLimit;
}

export function timeoutCfg() {
  return cfg().timeouts;
}

export function breakerCfg() {
  return cfg().breaker;
}
