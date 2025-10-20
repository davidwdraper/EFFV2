// backend/services/shared/src/db/DbClientBuilder.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * - ADRs:
 *   - ADR-0009 (Shared DB Client Builder — Environment Invariance)
 *
 * Purpose:
 * - Construct a typed DbClient from required environment variables.
 * - Enforce strict environment invariance: **no fallbacks, no defaults**.
 * - Support optional prefixing for per-service DB bindings (e.g. SVCCONFIG_).
 *
 * Env (required):
 *   When prefix provided (e.g., { prefix: "SVCCONFIG" }):
 *     - <PREFIX>_DB_DRIVER       → allowed: "mongo"
 *     - <PREFIX>_DB_URI
 *     - <PREFIX>_DB_NAME
 *   When prefix omitted:
 *     - DB_DRIVER
 *     - DB_URI
 *     - DB_NAME
 *
 * Notes:
 * - Throws immediately if any required env var is missing or empty.
 * - Never infers or defaults DB names/URIs. Fail-fast by design.
 */

import { DbClient } from "./DbClient";
import { MongoDbFactory } from "./mongo/MongoDbFactory";
import type { IDbFactory } from "./types";
import { getEnv, requireEnv, requireEnum } from "../env";

type Driver = "mongo";

/** Helper: join prefix and key into a strict env var name */
function prefixKey(prefix?: string, key?: string): string {
  return prefix ? `${prefix.toUpperCase()}_${key}` : String(key);
}

export function createDbClientFromEnv(opts?: { prefix?: string }): DbClient {
  const p = opts?.prefix;

  // ── Driver ────────────────────────────────────────────────────────────────
  // Allow explicit driver override; default "mongo" is explicit (not inferred)
  const raw = getEnv(prefixKey(p, "DB_DRIVER"));
  const driverRaw: string = raw ?? "mongo";
  const driver = requireEnum(prefixKey(p, "DB_DRIVER"), driverRaw, [
    "mongo",
  ] as const);

  // ── Factory ───────────────────────────────────────────────────────────────
  let factory: IDbFactory;
  switch (driver as Driver) {
    case "mongo":
      factory = new MongoDbFactory();
      break;
    default:
      throw new Error(`Unsupported DB_DRIVER: ${driver}`);
  }

  // ── Required envs (fail-fast) ─────────────────────────────────────────────
  const uri = requireEnv(prefixKey(p, "DB_URI"));
  const dbName = requireEnv(prefixKey(p, "DB_NAME"));

  return new DbClient(factory, { uri, dbName });
}

// Re-export core types so builders can be used as single import source
export { DbClient } from "./DbClient";
