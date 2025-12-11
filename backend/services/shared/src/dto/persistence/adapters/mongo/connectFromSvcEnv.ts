// backend/services/shared/src/dto/persistence/adapters/mongo/connectFromSvcEnv.ts
/**
 * Docs:
 * - ADR-0044 (EnvServiceDto as Key/Value Contract)
 * - ADR-0074 (DB_STATE + _infra database invariants)
 *
 * Purpose:
 * - Resolve a MongoDB collection using ONLY the svcEnv accessors.
 * - Uses getDbVar() for DB_STATE derivation (domain DBs).
 * - _infra DBs (names ending in "_infra") bypass DB_STATE logic.
 *
 * Required keys (no defaults):
 * - NV_MONGO_URI
 * - NV_MONGO_DB (base name; final name derived via getDbVar())
 * - NV_MONGO_COLLECTION
 */

// Minimal env-like contract to avoid hard-coupling to EnvServiceDto.
type EnvLike = {
  getEnvVar: (name: string) => string;
  getDbVar: (name: string) => string; // NEW — DB_STATE-aware accessor
};

// Lazy types to avoid hard dependency during compile in non-mongo services
type MongoClientCtor = new (...args: any[]) => any;

const K_URI = "NV_MONGO_URI";
const K_DB = "NV_MONGO_DB";
const K_COLLECTION = "NV_MONGO_COLLECTION";

/**
 * Resolve a MongoDB collection using svcEnv-derived configuration.
 *
 * Behavior:
 * - NV_MONGO_URI → via getEnvVar()
 * - NV_MONGO_DB  → via getDbVar()  (DB_STATE-aware)
 * - NV_MONGO_COLLECTION → via getEnvVar()
 *
 * Notes:
 * - getDbVar() implements DB_STATE suffixing except for *_infra DBs.
 * - All values must be non-empty; fail-fast otherwise.
 */
export async function getMongoCollectionFromSvcEnv(env: EnvLike): Promise<any> {
  let uri: string;
  let dbName: string;
  let collName: string;

  try {
    uri = env.getEnvVar(K_URI);
    dbName = env.getDbVar(K_DB); // <<<<<< FIXED
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
        "Ops: ensure NV_MONGO_URI, NV_MONGO_DB, and NV_MONGO_COLLECTION are set and valid in env-service."
    );
  }

  // Dynamically import to keep this adapter optional for non-mongo services.
  const { MongoClient }: { MongoClient: MongoClientCtor } = await import(
    "mongodb" as any
  );

  const client = await (MongoClient as any).connect(uri);
  const db = client.db(dbName);
  return db.collection(collName);
}
