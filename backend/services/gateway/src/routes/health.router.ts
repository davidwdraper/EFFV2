// backend/services/gateway/src/routes/health.router.ts

/**
 * Docs:
 * - Design: docs/design/backend/gateway/health.md
 * - SOP: docs/architecture/backend/SOP.md
 *
 * Why:
 * - One-liner route builder to keep app assembly clean and testable.
 */
import { createHealthRouter } from "@eff/shared/src/health";
import { serviceName } from "../config";
import { readiness } from "../readiness";

export function buildGatewayHealthRouter() {
  return createHealthRouter({ service: serviceName, readiness });
}
