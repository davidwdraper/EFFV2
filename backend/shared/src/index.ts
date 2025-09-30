// backend/shared/src/index.ts
/**
 * Curated exports (no god-barrel).
 */
export type { IDbFactory, IDbConnectionInfo } from "./db/types";
export { DbClient } from "./db/DbClient";
export { MongoDbFactory } from "./db/mongo/MongoDbFactory";
export { createDbClientFromEnv } from "./db/DbClientBuilder";

export * from "./env";

// Contracts
export * from "./contracts/ServiceConfig";

// Health
export type {
  HealthStatus,
  HealthCheckResult,
  HealthReport,
  IHealthCheck,
} from "./health/types";
export { HealthService } from "./health/HealthService";
export { CallbackCheck } from "./health/checks/CallbackCheck";
export { ProcessCheck } from "./health/checks/ProcessCheck";

// Bootstrap
export { Bootstrap } from "./bootstrap/Bootstrap";
