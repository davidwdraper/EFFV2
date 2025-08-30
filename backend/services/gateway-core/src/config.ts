import { requireEnum, requireNumber } from "../../shared/env";

export const SERVICE_NAME = "gateway-core" as const;
export const serviceName = SERVICE_NAME;
export const NODE_ENV = requireEnum("NODE_ENV", [
  "dev",
  "docker",
  "production",
]);
export const PORT = requireNumber("GATEWAY_CORE_PORT");

// ONLY explicit mappings. No fallbacks. No singularization. No aliases.
const UPSTREAM_ENV_BY_SVC: Record<string, string> = {
  geo: "GEO_SERVICE_URL",
};

export function resolveUpstreamBase(svc: string): {
  svcKey: string;
  base: string;
} {
  const svcKey = UPSTREAM_ENV_BY_SVC[svc];
  if (!svcKey) throw new Error(`Unknown service: ${svc}`);
  const raw = (process.env[svcKey] || "").trim();
  if (!raw) throw new Error(`Missing env ${svcKey}`);
  // fail HARD if anyone ever tries to route to 4007 again
  if (/127\.0\.0\.1:4007/.test(raw))
    throw new Error(`Refusing fallback :4007 for ${svcKey}`);
  return { svcKey, base: raw.replace(/\/+$/, "") };
}
