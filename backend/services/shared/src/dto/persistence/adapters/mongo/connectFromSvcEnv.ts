// backend/services/shared/src/dto/persistence/adapters/mongo/connectFromSvcEnv.ts
/**
 * Purpose:
 * - Utility to derive a Mongo collection from SvcEnvDto getters.
 * - No factories. If env is missing, throw with Ops guidance.
 */

import type { SvcEnvDto } from "../../../svcenv.dto";

// Lazy types to avoid hard dependency during compile in non-mongo services
type MongoClientCtor = new (...args: any[]) => any;

export async function getMongoCollectionFromSvcEnv(
  env: SvcEnvDto
): Promise<any> {
  // Expect svcEnv to expose getters; adapt these names to your actual SvcEnvDto
  const url = (env as any).mongoUrl?.() ?? (env as any).mongoUrl;
  const dbName = (env as any).mongoDbName?.() ?? (env as any).mongoDbName;
  const collName =
    (env as any).mongoCollection?.() ?? (env as any).mongoCollection;

  if (!url || !dbName || !collName) {
    const missing = [
      !url ? "mongoUrl" : null,
      !dbName ? "mongoDbName" : null,
      !collName ? "mongoCollection" : null,
    ].filter(Boolean);
    throw new Error(
      `SvcEnv incomplete for Mongo. Missing: ${missing.join(
        ", "
      )}. Ops: ensure env DTO validates and exposes these getters.`
    );
  }

  // Dynamically import to keep adapter optional outside Mongo users
  const { MongoClient }: { MongoClient: MongoClientCtor } = await import(
    "mongodb" as any
  );

  const client = await (MongoClient as any).connect(url);
  const db = client.db(dbName);
  return db.collection(collName);
}
