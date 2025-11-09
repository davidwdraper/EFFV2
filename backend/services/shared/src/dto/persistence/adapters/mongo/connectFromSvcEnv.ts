// backend/services/shared/src/dto/persistence/adapters/mongo/connectFromSvcEnv.ts
/**
 * Docs:
 * - ADR-0044 (EnvServiceDto as Key/Value Contract)
 *
 * Purpose:
 * - Resolve a MongoDB collection using ONLY generic key access on an env DTO.
 * - No DTO-specific getters beyond getEnvVar(name: string).
 * - No defaults. Fail-fast with actionable messages for Ops.
 *
 * Notes:
 * - Historically this used SvcEnvDto; now it works with any DTO that
 *   implements getEnvVar(name: string): string (e.g., EnvServiceDto).
 */

// Minimal env-like contract to avoid hard-coupling to a specific DTO class.
type EnvLike = {
  getEnvVar: (name: string) => string;
};

// Lazy types to avoid hard dependency during compile in non-mongo services
type MongoClientCtor = new (...args: any[]) => any;

const K_URI = "NV_MONGO_URI";
const K_DB = "NV_MONGO_DB";
const K_COLLECTION = "NV_MONGO_COLLECTION";

/**
 * Resolve a MongoDB collection using env-style key/value config.
 *
 * Required keys (no defaults):
 * - NV_MONGO_URI
 * - NV_MONGO_DB
 * - NV_MONGO_COLLECTION
 */
export async function getMongoCollectionFromSvcEnv(env: EnvLike): Promise<any> {
  let uri: string;
  let dbName: string;
  let collName: string;

  try {
    uri = env.getEnvVar(K_URI);
    dbName = env.getEnvVar(K_DB);
    collName = env.getEnvVar(K_COLLECTION);
  } catch (e) {
    const msg =
      (e as Error)?.message ??
      `Missing required Mongo env vars (${K_URI}, ${K_DB}, ${K_COLLECTION}).`;
    throw new Error(
      `${msg} Ops: update env-service configuration for this service/version; keys must be present and non-empty.`
    );
  }

  if (!uri || !dbName || !collName) {
    throw new Error(
      `MONGO_ENV_MISCONFIG: One or more Mongo keys are empty (uri='${uri}', db='${dbName}', collection='${collName}'). ` +
        "Ops: ensure NV_MONGO_URI, NV_MONGO_DB, and NV_MONGO_COLLECTION are set to non-empty strings in env-service."
    );
  }

  // Dynamically import to keep adapter optional outside Mongo users
  const { MongoClient }: { MongoClient: MongoClientCtor } = await import(
    "mongodb" as any
  );

  const client = await (MongoClient as any).connect(uri);
  const db = client.db(dbName);
  return db.collection(collName);
}
