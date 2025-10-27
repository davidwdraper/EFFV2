// backend/services/shared/src/dto/persistence/adapters/mongo/connectFromSvcEnv.ts
/**
 * Docs:
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Resolve a MongoDB collection using ONLY generic key access on SvcEnvDto.
 * - No DTO-specific getters. No defaults. Fail-fast with actionable messages.
 */

import type { SvcEnvDto } from "../../../svcenv.dto";

// Lazy types to avoid hard dependency during compile in non-mongo services
type MongoClientCtor = new (...args: any[]) => any;

const K_URI = "NV_MONGO_URI";
const K_DB = "NV_MONGO_DB";
const K_COLLECTION = "NV_MONGO_COLLECTION";

export async function getMongoCollectionFromSvcEnv(
  env: SvcEnvDto
): Promise<any> {
  // ADR-0044: use generic getters; never rely on DTO-specific fields
  let uri: string, dbName: string, collName: string;
  try {
    uri = env.getEnvVar(K_URI);
    dbName = env.getEnvVar(K_DB);
    collName = env.getEnvVar(K_COLLECTION);
  } catch (e) {
    // Preserve the original message but add Ops guidance
    const msg =
      (e as Error)?.message ??
      `Missing required Mongo env vars (${K_URI}, ${K_DB}, ${K_COLLECTION}).`;
    throw new Error(
      `${msg} Ops: update svcenv for this service version; keys must be present and non-empty.`
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
