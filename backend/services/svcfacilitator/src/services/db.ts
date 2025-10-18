// backend/services/svcfacilitator/src/services/db.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: env invariance; fail fast; no hidden defaults
 *
 * Purpose:
 * - Build a DbClient explicitly for SvcFacilitator using service-owned env vars.
 * - No prefix algorithms, no fallbacks. The service owns its storage config.
 */

import { DbClient } from "@nv/shared/db/DbClient";
import { MongoDbFactory } from "@nv/shared/db/mongo/MongoDbFactory";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return v.trim();
}

/** Explicit, service-owned DB client for facilitator. */
export function getSvcFacilitatorDb(): DbClient {
  const uri = requireEnv("SVCCONFIG_DB_URI");
  const dbName = requireEnv("SVCCONFIG_DB_NAME");
  return new DbClient(new MongoDbFactory(), { uri, dbName });
}
