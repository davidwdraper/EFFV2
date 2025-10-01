// backend/shared/src/db/mongo/MongoDbFactory.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - MongoDB-specific factory implementing IDbFactory, to be injected into DbClient.
 */

import { MongoClient, Db, Collection, type Document } from "mongodb";
import type { IDbConnectionInfo, IDbFactory } from "../types";

export class MongoDbFactory implements IDbFactory {
  private client: MongoClient | null = null;
  private _connected = false;

  public async connect(info: IDbConnectionInfo): Promise<void> {
    if (this._connected && this.client) return;
    const client = new MongoClient(info.uri, {
      serverSelectionTimeoutMS: 2000,
    });
    await client.connect();
    this.client = client;
    this._connected = true;
  }

  public async close(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.close();
    } finally {
      this.client = null;
      this._connected = false;
    }
  }

  public isConnected(): boolean {
    return this._connected && !!this.client;
  }

  public getDb(dbName?: string): Db {
    if (!this.client) throw new Error("[MongoDbFactory] not connected");
    if (!dbName) throw new Error("[MongoDbFactory] dbName required");
    return this.client.db(dbName);
  }

  // Constrain TSchema to Document per mongodb typings.
  public getCollection<TSchema extends Document = Document>(
    name: string,
    dbName?: string
  ): Collection<TSchema> {
    const db = this.getDb(dbName);
    return db.collection<TSchema>(name);
  }
}
