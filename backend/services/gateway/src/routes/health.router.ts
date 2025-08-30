// backend/services/gateway/src/routes/health.router.ts
import { createHealthRouter } from "../../../shared/health";
import { serviceName } from "../config";
import { readiness } from "../readiness";

export function buildGatewayHealthRouter() {
  return createHealthRouter({ service: serviceName, readiness });
}
