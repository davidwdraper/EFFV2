// backend/services/gateway-core/src/bootstrap.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/MICROSERVICES.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0026-gateway-core-on-shared-createServiceApp-internal-only-s2s-relay.md
 *
 * Why:
 * - Gateway-core is an internal-only S2S relay. All env loading must use the
 *   shared cascade (repo → family → service) so that:
 *     1) local .env.dev/.env.test/.env.docker are merged consistently,
 *     2) required variables are asserted early and loudly,
 *     3) downstream imports (e.g. logger) see the correct values at init time.
 */

import { loadEnvCascadeForService, assertEnv } from "@eff/shared/src/env";

export const SERVICE_NAME = "gateway-core";

/**
 * Load env files in the strict repo→family→service order.
 * Later files win; missing files are tolerated only for
 * dev/test cascades as documented in ADR-0017.
 */
loadEnvCascadeForService(__dirname);

/**
 * Fail fast if any required variable is missing.
 * Keep this list minimal and S2S-focused: anything else is
 * service-specific and should be validated in its own module.
 */
assertEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "GATEWAY_CORE_PORT", // HTTP listener
  "S2S_JWT_SECRET", // inbound verification secret (HS256)
  "S2S_JWT_ISSUER", // expected issuer(s)
  "S2S_JWT_AUDIENCE", // expected audience(s)
  // outbound minting secrets/claims are validated at call-site
]);

// Optional visibility for internal S2S plane (safe to log)
console.log(
  `[${SERVICE_NAME}] S2S plane: iss=%s aud=%s`,
  process.env.S2S_JWT_ISSUER,
  process.env.S2S_JWT_AUDIENCE
);
