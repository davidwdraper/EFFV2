// backend/shared/src/db/DbClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Thin, reusable wrapper around a driver-specific IDbFactory.
 * - Owns connection lifecycle + lazy connect; exposes typed helpers.
 *
 * Notes:
 * - Use one DbClient per service/process (or per data source).
 */

import type { IDbFactory, IDbConnectionInfo } from "./types";

export class DbClient {
  private readonly factory: IDbFactory;
  private readonly info: IDbConnectionInfo;
  private _connected = false;

  constructor(factory: IDbFactory, info: IDbConnectionInfo) {
    this.factory = factory;
    this.info = info;
  }

  /**
   * Explicit connect (safe to call multiple times).
   */
  public async connect(): Promise<void> {
    if (this._connected && this.factory.isConnected()) return;
    await this.factory.connect(this.info);
    this._connected = this.factory.isConnected();
    if (!this._connected) {
      throw new Error(
        "[DbClient] factory reported not connected after connect()"
      );
    }
  }

  /**
   * Ensure connected before an operation (lazy connect).
   */
  private async ensure(): Promise<void> {
    if (!this._connected || !this.factory.isConnected()) {
      await this.connect();
    }
  }

  /**
   * Get a driver-specific DB handle (e.g., Mongo.Db).
   */
  public async getDb(dbName?: string): Promise<unknown> {
    await this.ensure();
    return this.factory.getDb(dbName ?? this.info.dbName);
  }

  /**
   * Get a driver-specific collection handle (e.g., Mongo.Collection<T>).
   */
  public async getCollection<T = unknown>(
    name: string,
    dbName?: string
  ): Promise<unknown> {
    await this.ensure();
    return this.factory.getCollection<T>(name, dbName ?? this.info.dbName);
  }

  /**
   * Close the connection (safe to call multiple times).
   */
  public async close(): Promise<void> {
    await this.factory.close();
    this._connected = false;
  }

  /**
   * Snapshot connectivity.
   */
  public isConnected(): boolean {
    return this._connected && this.factory.isConnected();
  }
}
