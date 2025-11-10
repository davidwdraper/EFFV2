// // backend/services/shared/src/index.ts
// /**
//  * Curated exports (no god-barrel).
//  */
// export type { IDbFactory, IDbConnectionInfo } from "./db/types";
// export { DbClient } from "./db/DbClient";
// export { MongoDbFactory } from "./db/mongo/MongoDbFactory";
// export { createDbClientFromEnv } from "./db/DbClientBuilder";

// export * from "./env";

// // Contracts
// export * from "./contracts/svcconfig.contract";

// // Health
// export type {
//   HealthStatus,
//   HealthCheckResult,
//   HealthReport,
//   IHealthCheck,
// } from "./health/types";
// export { HealthService } from "./health/HealthService";
// export { CallbackCheck } from "./health/checks/CallbackCheck";
// export { ProcessCheck } from "./health/checks/ProcessCheck";

// // Bootstrap
// export { Bootstrap } from "./bootstrap/Bootstrap";

// // S2S
// export { SvcClient } from "./svc/SvcClient";
// export { SvcReceiver } from "./svc/SvcReceiver";
// export type {
//   SvcMethod,
//   SvcCallOptions,
//   SvcResponse,
//   UrlResolver,
//   HttpLikeRequest,
//   HttpLikeResponse,
// } from "./svc/types";

// backend/services/shared/src/index.ts

/**
 * Shared package entrypoint.
 *
 * For now this is intentionally minimal: all consumers use deep imports
 * like "@nv/shared/dto/xxx.dto". As we stabilize a public surface,
 * explicit exports can be added here.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export {};
