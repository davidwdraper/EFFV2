// backend/services/gateway/src/config.ts

import {
  loadEnvFileOrDie,
  requireEnum,
  requireNumber,
  requireEnv,
} from "../../shared/env";

export const SERVICE_NAME = "gateway" as const;

// Load .env.<NODE_ENV> (dev|docker|production) from repo tree or die
loadEnvFileOrDie();

// Enforce valid mode
export const NODE_ENV = requireEnum("NODE_ENV", [
  "dev",
  "docker",
  "production",
]);

// Map old -> new: ORCHESTRATOR_CORE_PORT ➜ GATEWAY_PORT (no default!)
if (process.env.ORCHESTRATOR_CORE_PORT && !process.env.GATEWAY_PORT) {
  // allow a transition period by honoring the old var only if explicitly set
  process.env.GATEWAY_PORT = process.env.ORCHESTRATOR_CORE_PORT;
}
export const PORT = requireNumber("GATEWAY_PORT");

// Optional toggles (ok if missing)
export const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "true") !== "false";
export const LOG_LEVEL = process.env.LOG_LEVEL;
export const TRACE_ENABLED = process.env.TRACE_ENABLED;
export const TRACE_SAMPLE = process.env.TRACE_SAMPLE;
export const REDACT_HEADERS = process.env.REDACT_HEADERS;
export const AUDIT_ENABLED = process.env.AUDIT_ENABLED;
export const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL;

// Upstream URL getters — no defaults, and we only require when actually used.
// Example usage in a proxy: const USER_URL = requireUpstream("USER_SERVICE_URL");
export function requireUpstream(
  name:
    | "USER_SERVICE_URL"
    | "ACT_SERVICE_URL"
    | "PLACE_SERVICE_URL"
    | "EVENT_SERVICE_URL"
) {
  return requireEnv(name);
}
