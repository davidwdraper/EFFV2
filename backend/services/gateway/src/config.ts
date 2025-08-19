// backend/services/gateway/src/config.ts

import { requireEnum, requireNumber, requireEnv } from "../../shared/env";

// NOTE: Env is loaded/validated by ./src/bootstrap first.
// We intentionally do NOT call loadEnvFileOrDie() here to avoid double-loading.

export const SERVICE_NAME = "gateway" as const;

// Enforce valid mode (no defaults)
export const NODE_ENV = requireEnum("NODE_ENV", [
  "dev",
  "docker",
  "production",
]);

// Back-compat remap: ORCHESTRATOR_CORE_PORT → GATEWAY_PORT (no default!)
if (process.env.ORCHESTRATOR_CORE_PORT && !process.env.GATEWAY_PORT) {
  process.env.GATEWAY_PORT = process.env.ORCHESTRATOR_CORE_PORT;
}

// Required listen port
export const PORT = requireNumber("GATEWAY_PORT");

// Optional toggles (ok if missing — no defaults applied)
export const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "true") !== "false";
export const LOG_LEVEL = process.env.LOG_LEVEL;
export const TRACE_ENABLED = process.env.TRACE_ENABLED;
export const TRACE_SAMPLE = process.env.TRACE_SAMPLE;
export const REDACT_HEADERS = process.env.REDACT_HEADERS;
export const AUDIT_ENABLED = process.env.AUDIT_ENABLED;
export const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL;

/**
 * Strict upstream resolver (no defaults). Example:
 *   const ACT_URL = requireUpstream("ACT_SERVICE_URL");
 */
export function requireUpstream(
  name:
    | "USER_SERVICE_URL"
    | "ACT_SERVICE_URL"
    | "PLACE_SERVICE_URL"
    | "EVENT_SERVICE_URL"
) {
  return requireEnv(name);
}

// Optional convenience alias for consistency in app files
export const serviceName = SERVICE_NAME;
