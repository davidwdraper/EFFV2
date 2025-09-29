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
