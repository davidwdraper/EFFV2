// backend/shared/src/db/types.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Interfaces for DB client + factory so services can depend on abstractions.
 */

export interface IDbConnectionInfo {
  uri: string;
  dbName: string;
}

export interface IDbFactory {
  /**
   * Establish a connection (idempotent). Multiple calls are safe.
   */
  connect(info: IDbConnectionInfo): Promise<void>;

  /**
   * Close connection (idempotent).
   */
  close(): Promise<void>;

  /**
   * Whether the underlying driver considers itself connected.
   */
  isConnected(): boolean;

  /**
   * Get a database handle (driver-specific object).
   * Throws if not connected.
   */
  getDb(dbName?: string): unknown;

  /**
   * Obtain a collection handle typed to T (driver-specific).
   * Throws if not connected.
   */
  getCollection<T = unknown>(name: string, dbName?: string): unknown;
}
