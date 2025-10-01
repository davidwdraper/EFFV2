// backend/shared/src/db/DbClientBuilder.ts
/**
 * Docs:
 * - Build a DbClient from environment variables (supports prefixes).
 *
 * Env resolution (first defined wins):
 *   DRIVER:   <PREFIX>_DB_DRIVER  → DB_DRIVER         (default: "mongo")
 *   URI:      <PREFIX>_DB_URI     → DB_URI            → MONGO_URI
 *   NAME:     <PREFIX>_DB_NAME    → DB_NAME           → MONGO_DB
 */
import { DbClient } from "./DbClient";
import { MongoDbFactory } from "./mongo/MongoDbFactory";
import type { IDbFactory } from "./types";
import { getEnv, requireEnv, requireEnum } from "../env";

type Driver = "mongo"; // extend later (e.g., "postgres", "mysql")

function pick(firstDefined: Array<string | undefined>): string | undefined {
  return firstDefined.find(
    (v) => v != null && v !== undefined && v.trim() !== ""
  );
}

export function createDbClientFromEnv(opts?: { prefix?: string }): DbClient {
  const prefix = opts?.prefix ? opts.prefix.toUpperCase() + "_" : "";

  const driver = (pick([getEnv(`${prefix}DB_DRIVER`), getEnv("DB_DRIVER")]) ??
    "mongo") as string;
  const normDriver = requireEnum("DB_DRIVER", driver, ["mongo"] as const);

  let factory: IDbFactory;
  switch (normDriver as Driver) {
    case "mongo":
    default:
      factory = new MongoDbFactory();
      break;
  }

  const uri =
    pick([getEnv(`${prefix}DB_URI`), getEnv("DB_URI"), getEnv("MONGO_URI")]) ??
    requireEnv(`${prefix}DB_URI or DB_URI or MONGO_URI`);

  const dbName =
    pick([getEnv(`${prefix}DB_NAME`), getEnv("DB_NAME"), getEnv("MONGO_DB")]) ??
    requireEnv(`${prefix}DB_NAME or DB_NAME or MONGO_DB`);

  return new DbClient(factory, { uri, dbName });
}
